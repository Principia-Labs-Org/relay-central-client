"""Run a native Grok Build or Muse Code tool turn against a local scripted model.

Use a synthetic Central login and an already installed plugin. No live model
credential is needed. By default the model asks for staffMe. Pass a disposable
two-org --tenant-fixture to qualify scoped reads and writes with the saved A login.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from shutil import which
import subprocess
import tempfile
from threading import Thread
from host_tenants import Case, TenantCheck

MODEL = "relay-plugin-check"


class Model(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, body, mime):
        data = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        row = {"id": MODEL, "object": "model", "metadata": {"muse-code": {
            "release_date": "2026-01-01", "is_hidden": False, "limit": {"context": 128000, "output": 1024}
        }}}
        self.reply(json.dumps({"object": "list", "data": [row]}), "application/json")

    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        if self.server.tenants is not None:
            assert self.server.tenants.token.encode() not in raw
        body = json.loads(raw)
        case = self.server.case
        names = [tool.get("name") or tool.get("function", {}).get("name", "") for tool in body.get("tools", [])]
        name = next((n for n in names if n.endswith(case.tool)), None)
        namespace = next((tool["name"] for tool in body.get("tools", [])
                          if tool.get("type") == "namespace"
                          and any(fn.get("name") == case.tool for fn in tool["tools"])), None)
        if namespace:
            name = namespace + "." + case.tool
        arguments = case.arguments
        if "use_tool" in names:
            # Grok exposes MCP tools through its native catalog dispatcher.
            name = "use_tool"
            arguments = {"tool_name": "relay-central__" + case.tool, "tool_input": case.arguments}
        request_tool = name is not None and not self.server.called
        if request_tool:
            self.server.called = True
        # Verify the result the native host actually submits back to the model.
        for message in body.get("input", body.get("messages", [])):
            if isinstance(message, dict) and (message.get("role") == "tool" or message.get("type") == "function_call_output"):
                output = message.get("content", message.get("output"))
                if self.server.verified:
                    continue
                for result in decoded_results(output):
                    if self.server.tenants is None:
                        self.server.verified = result == self.server.identity
                    else:
                        try:
                            self.server.tenants.verify(case, result, isinstance(result, str))
                        except (AssertionError, KeyError, TypeError):
                            continue
                        self.server.verified = True
                    if self.server.verified:
                        break
        if self.path.rstrip("/").endswith("responses"):
            frame = {"id": "resp_check", "object": "response", "model": MODEL, "output": []}
            events = [{"type": "response.created", "response": dict(frame, status="in_progress")}]
            if request_tool:
                function = {"type": "function_call", "name": name, "call_id": "call_check",
                            "arguments": json.dumps(arguments), "id": "fc_check"}
                if namespace:
                    function["namespace"] = namespace
                events.extend([
                    {"type": "response.output_item.added", "output_index": 0, "item": function},
                    {"type": "response.function_call_arguments.done", "output_index": 0, "item_id": "fc_check",
                     "name": name, "call_id": "call_check", "arguments": json.dumps(arguments), "namespace": namespace},
                    {"type": "response.output_item.done", "output_index": 0, "item": function}
                ])
            else:
                events.append({"type": "response.output_text.delta", "output_index": 0, "content_index": 0,
                               "item_id": "msg_check", "delta": "Finished."})
            events.append({"type": "response.completed", "response": dict(frame, status="completed",
                           usage={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2})})
            stream = "".join("data: " + json.dumps(dict(event, sequence_number=i)) + "\n\n"
                             for i, event in enumerate(events, 1))
        else:
            call = {"index": 0, "id": "call_check", "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}
            delta = {"role": "assistant", "tool_calls": [call]} if request_tool else {"role": "assistant", "content": "Finished."}
            frame = {"id": "chat_check", "object": "chat.completion.chunk", "created": 1, "model": MODEL}
            chunks = [dict(frame, choices=[{"index": 0, "delta": delta, "finish_reason": None}]),
                      dict(frame, choices=[{"index": 0, "delta": {}, "finish_reason": "tool_calls" if request_tool else "stop"}])]
            stream = "".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n"
        self.reply(stream, "text/event-stream")


def decoded_results(value):
    """Grok and Muse return tool output as text or a list of MCP content blocks."""
    if isinstance(value, list):
        for block in value:
            yield from decoded_results(block)
    elif isinstance(value, dict):
        yield value
        for key in ("text", "content", "output", "result", "data"):
            if key in value:
                yield from decoded_results(value[key])
    elif isinstance(value, str):
        yield value
        # Some hosts prefix their JSON tool result with a human-readable label.
        for opening in re.finditer(r"[\{\[]", value):
            try:
                data, _ = json.JSONDecoder().raw_decode(value[opening.start():])
            except ValueError:
                continue
            yield from decoded_results(data)
            break


def check(host, tenants, case):
    with tempfile.TemporaryDirectory() as tmp, ThreadingHTTPServer(("127.0.0.1", 0), Model) as model:
        base = f"http://127.0.0.1:{model.server_port}/v1"
        model.called = model.verified = False
        model.tenants, model.case = tenants, case
        model.identity = json.loads(subprocess.check_output(["relay-central", "whoami"]))
        Thread(target=model.serve_forever, daemon=True).start()
        env = dict(os.environ)
        if host == "muse":
            approvals = ["--disable-approval"] if tenants else []
            command = ["muse", "exec", "--trust-workspace", *approvals, "--provider", "meta", "--model", MODEL,
                       "--base-url", base, "--api-key-stdin", "--max-model-steps", "4", "--no-session-log",
                       case.name + ". Use the Relay Central plugin in this disposable test."]
        else:
            # Use the manifest shipped with the npm-installed executable.
            package = Path(which("relay-central")).resolve().parents[1]
            plugin = package / "plugins" / "relay-central"
            settings = Path(tmp) / "grok"
            settings.mkdir()
            (settings / "config.toml").write_text(
                f'[model.{MODEL}]\nmodel="{MODEL}"\nbase_url="{base}"\napi_key="loopback-fixture"\n'
                'context_window=128000\n[cli]\nauto_update=false\n[features]\ntelemetry=false\n'
            )
            env.update(GROK_HOME=str(settings), XAI_API_KEY="loopback-fixture")
            subprocess.run(["grok", "plugin", "install", str(plugin), "--trust"], cwd=tmp, env=env,
                           check=True, capture_output=True, timeout=30)
            command = ["grok", "-m", MODEL, "--max-turns", "4", "--no-memory", "--allow",
                       f"MCPTool(relay-central__{case.tool})", "-p",
                       case.name + ". Use the Relay Central plugin in this disposable test."]
        try:
            result = subprocess.run(command, cwd=tmp, env=env, input="loopback-fixture\n" if host == "muse" else "",
                                    capture_output=True, text=True, timeout=60)
            if result.returncode or not model.verified:
                raise RuntimeError(f"{host} exited {result.returncode}, requested {case.tool}={model.called}, "
                                   f"matched expected tool result={model.verified}")
            print(f"{host}: {case.name} verified", flush=True)
        finally:
            model.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", choices=("grok", "muse"))
    parser.add_argument("--tenant-fixture", help="Loopback test fixture FILE or - on stdin; sign in as A first")
    args = parser.parse_args()
    tenants = TenantCheck(args.tenant_fixture) if args.tenant_fixture else None
    for case in tenants.cases if tenants else (Case("A identity", "staffMe", {}),):
        check(args.host, tenants, case)
    if tenants:
        tenants.finish()
        print(f"{args.host}: B unchanged including revision")
