"""Exercise an installed Relay Central plugin through Codex without a model turn.

Run after CLI login and plugin installation in the same account: python3 test/codex-plugin.py
For native tenant checks, sign a disposable OS account into fixture A and pass
--tenant-fixture FILE from the loopback two-organization test server.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import threading
from host_tenants import TenantCheck


def check(cwd, tenants=None):
    with subprocess.Popen(["codex", "app-server"], cwd=cwd, stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, text=True) as codex:
        # Bound an unresponsive plugin or unavailable installation.
        timeout = threading.Timer(60, codex.kill)
        timeout.start()
        sequence = 0

        def request(method, params, notify=False):
            nonlocal sequence
            sequence += 1
            message = {"method": method, "params": params}
            if not notify:
                message["id"] = sequence
            codex.stdin.write(json.dumps(message) + "\n")
            codex.stdin.flush()
            if notify:
                return
            for line in codex.stdout:
                reply = json.loads(line)
                if reply.get("id") == sequence:
                    if "error" in reply:
                        raise RuntimeError(f"{method} failed: {reply['error']['message']}")
                    return reply["result"]
            raise RuntimeError(f"Codex closed the connection during {method}")

        try:
            request("initialize", {"clientInfo": {"name": "relay-central-check", "version": "1"},
                                   "capabilities": {"experimentalApi": True}})
            request("initialized", {}, notify=True)
            thread = request("thread/start", {"cwd": cwd, "ephemeral": True})["thread"]["id"]
            status = request("mcpServerStatus/list", {"threadId": thread, "serverName": "relay-central"})
            server, = status["data"]
            def call(tool, arguments):
                assert tool in server["tools"], f"Relay Central tool {tool} missing"
                result = request("mcpServer/tool/call", {"threadId": thread, "server": server["name"],
                                                         "tool": tool, "arguments": arguments})
                payload = result["content"][0]["text"]
                is_error = result.get("isError", False)
                return (payload if is_error else json.loads(payload)), is_error

            if tenants:
                for case in tenants.cases:
                    tenants.verify(case, *call(case.tool, case.arguments))
                tenants.finish()
                print("Codex verified A identity, retrieved A's campaign, updated A and read its next revision. "
                      "B's campaign read and valid update both returned HTTP 404. "
                      "An independent B login confirmed its campaign and revision were unchanged.")
            else:
                identity, is_error = call("staffMe", {})
                assert not is_error and identity["org_id"] and identity["role"] in ("admin", "operator", "viewer")
                print(f"Codex discovered {len(server['tools'])} tools and verified the signed-in identity.")
        finally:
            timeout.cancel()
            codex.terminate()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-fixture", type=Path, help="Private fixture created by the disposable Central test")
    args = parser.parse_args()
    tenants = TenantCheck(args.tenant_fixture) if args.tenant_fixture else None
    with tempfile.TemporaryDirectory() as workspace:
        check(str(Path(workspace).resolve()), tenants)
