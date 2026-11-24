"""Run Claude Code's installed plugin against disposable Central and a local model fixture.

Requires Claude Code, Node 22+, Docker, psql and a built CENTRAL_CHECKOUT as in
test/central-e2e.py. The loopback model requests real plugin operations for two
synthetic tenants while Claude Code is signed into only the first organization.
"""
import json
import os
import runpy
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from host_tenants import TenantCheck
from tenant_fixture import tenant_pair

ROOT = Path(__file__).resolve().parents[1]
shared = runpy.run_path(str(ROOT / "test/central-e2e.py"))


class Messages(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        state = self.server
        if any(secret in raw or secret in self.headers.as_bytes() or secret in self.path.encode()
               for secret in state.secrets):
            state.leaked = True
            self.send_error(400)
            return
        request = json.loads(raw)
        if self.path.startswith("/v1/messages/count_tokens"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"input_tokens":100}')
            return
        if not self.path.startswith("/v1/messages"):
            self.send_error(404)
            return
        name = next((t["name"] for t in request.get("tools", [])
                     if t.get("name", "").endswith("__" + state.operation)), None)
        blocks = [block for message in request["messages"] if isinstance(message["content"], list)
                  for block in message["content"] if isinstance(block, dict)]
        result = next((b for b in blocks if b.get("type") == "tool_result"
                       and b.get("tool_use_id") == "toolu_central_fixture"), None)
        if result:
            payload = result["content"]
            if isinstance(payload, list):
                payload = next((part["text"] for part in payload if part.get("type") == "text"), "")
            state.result = (payload, bool(result.get("is_error")))
            content = {"type": "text", "text": "Fixture tool returned."}
        elif name:
            state.selected = name
            content = {"type": "tool_use", "id": "toolu_central_fixture", "name": name, "input": {}}
        else:
            content = {"type": "text", "text": "The requested fixture tool was unavailable."}

        # Claude Code asks for a streamed Anthropic Messages response.
        reason = "tool_use" if content["type"] == "tool_use" else "end_turn"
        usage = {"input_tokens": 100, "output_tokens": 4}
        message = {"type": "message", "id": "msg_fixture", "role": "assistant",
                   "model": request["model"], "usage": usage, "content": [], "stop_reason": None}
        start = {**content, "text": ""} if content["type"] == "text" else content
        delta = ({"type": "text_delta", "text": content["text"]} if content["type"] == "text" else
                 {"type": "input_json_delta", "partial_json": json.dumps(state.arguments)})
        events = [("message_start", {"message": message}),
                  ("content_block_start", {"index": 0, "content_block": start}),
                  ("content_block_delta", {"index": 0, "delta": delta}),
                  ("content_block_stop", {"index": 0}),
                  ("message_delta", {"delta": {"stop_reason": reason, "stop_sequence": None}, "usage": usage}),
                  ("message_stop", {})]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for event, data in events:
            self.wfile.write(f"event: {event}\ndata: {json.dumps(dict(type=event, **data))}\n\n".encode())


def exercise(directory, binary, central, claude):
    pair = tenant_pair(central, "Claude")
    with ThreadingHTTPServer(("127.0.0.1", 0), Messages) as model:
        model.secrets = [pair[key]["token"].encode() for key in ("A", "B")]
        model.leaked = False
        threading.Thread(target=model.serve_forever, daemon=True).start()
        env = {"PATH": str(binary.parent) + os.pathsep + os.environ["PATH"],
               "XDG_CONFIG_HOME": str(directory / "config"), "CLAUDE_CONFIG_DIR": str(directory / "claude"),
               "ANTHROPIC_BASE_URL": f"http://127.0.0.1:{model.server_port}",
               "ANTHROPIC_AUTH_TOKEN": "loopback-model-fixture", "ENABLE_TOOL_SEARCH": "false",
               "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}
        def run(command, **kwargs):
            return subprocess.run(command, cwd=directory, env=env, text=True, capture_output=True,
                                  timeout=90, check=True, **kwargs).stdout

        def call(operation, arguments):
            model.operation, model.arguments = operation, arguments
            model.selected = model.result = None
            name = "mcp__plugin_relay-central_relay-central__" + operation
            output = run([claude, "-p", "Run the Relay Central synthetic fixture operation.",
                          "--model", "sonnet", "--output-format", "json", "--no-session-persistence",
                          "--tools", "", "--allowedTools", name])
            assert not model.leaked, "Central token reached the model"
            assert model.selected == name and model.result is not None, f"Missing plugin result for {operation}"
            assert json.loads(output)["result"] == "Fixture tool returned."
            return model.result

        try:
            run([binary, "login", "--origin", central.base, "--token-stdin"], input=pair["A"]["token"])
            package_root = binary.resolve().parents[1]
            run([claude, "plugin", "marketplace", "add", package_root])
            run([claude, "plugin", "install", "relay-central@relay-platform"])
            status, expected, _ = central.request("/organization", token=pair["A"]["token"])
            assert status == 200 and expected["id"] == central.org
            text, error = call("getOrganizationConfiguration", {})
            assert not error and json.loads(text) == expected
            check = TenantCheck(pair)
            for case in check.cases:
                text, error = call(case.tool, case.arguments)
                check.verify(case, text if error else json.loads(text), error)
            check.finish()
            print("Claude Code read A's configuration and updated A's campaign. B's campaign GET and "
                  "PATCH returned HTTP 404. B's own token confirmed its record and revision were unchanged. "
                  "No Central token reached the model.")
        finally:
            model.shutdown()


def main():
    claude = shutil.which("claude")
    if not claude:
        sys.exit("Install Claude Code before running this host test.")
    checkout = shared["CHECKOUT"]
    sys.path.insert(0, str(checkout / "scripts"))
    from verify_local import clean_environment
    clean = clean_environment()
    os.environ.clear()
    os.environ.update(clean)
    with tempfile.TemporaryDirectory(prefix="relay-claude-host-") as temp:
        directory = Path(temp)
        binary = shared["installed_cli"](directory)
        with shared["disposable_db"]() as db:
            os.environ["TEST_DATABASE_URL"] = db
            sys.path.insert(0, str(checkout / "tests"))
            from admin_configuration_e2e import Administration
            Administration.setUpClass()
            try:
                exercise(directory, binary, Administration, claude)
            finally:
                Administration.tearDownClass()


if __name__ == "__main__":
    main()
