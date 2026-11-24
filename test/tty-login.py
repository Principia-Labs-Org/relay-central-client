"""Exercise interactive token login on a POSIX terminal with a disposable HTTP fixture."""
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import tempfile
import termios
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CLI = Path(__file__).resolve().parents[1] / "bin" / "relay-central.js"
TOKEN = "synthetic-tty-secret"


class Central(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        status = 200
        if self.path == "/openapi/agent.json":
            data = {"paths": {"/api/auth/me": {"get": {"operationId": "staffMe", "x-required-role": "viewer"}}}}
        elif self.path == "/api/auth/me":
            file = self.server.credentials
            self.server.pre_auth.append(file.read_bytes() if file.exists() else None)
            if self.headers.get("Authorization") == "Bearer " + TOKEN:
                data = {"org_id": "synthetic", "user_id": "viewer", "role": "viewer"}
            else:
                status, data = 401, {"error": "Invalid token"}
        else:
            status, data = 404, {"error": "Unknown path"}
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def login(origin, config, text, terminator):
    master, slave = pty.openpty()
    output = bytearray()
    try:
        original = termios.tcgetattr(slave)
        with subprocess.Popen([shutil.which("node"), CLI, "login", "--origin", origin],
                              env={"PATH": os.environ["PATH"], "XDG_CONFIG_HOME": str(config)},
                              stdin=slave, stdout=slave, stderr=slave) as proc:
            try:
                deadline = time.monotonic() + 10
                while b"(hidden): " not in output:
                    remaining = max(0, deadline - time.monotonic())
                    assert select.select([master], [], [], remaining)[0], "Missing token prompt"
                    output += os.read(master, 4096)
                assert not termios.tcgetattr(slave)[3] & termios.ECHO, "TTY echoed during token entry"
                os.write(master, text.encode() + terminator)
                proc.wait(10)
                while select.select([master], [], [], 0)[0]:
                    output += os.read(master, 4096)
            finally:
                if proc.poll() is None:
                    proc.kill()
        assert termios.tcgetattr(slave) == original, "Login changed the caller's terminal settings"
        assert text.encode() not in output, "The typed token appeared in the terminal output"
        return proc.returncode, bytes(output)
    finally:
        os.close(master)
        os.close(slave)


def main():
    with tempfile.TemporaryDirectory() as temp, ThreadingHTTPServer(("127.0.0.1", 0), Central) as server:
        config = Path(temp)
        server.credentials = config / "relay-central-client" / "credentials.json"
        server.pre_auth = []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            code, out = login(origin, config, TOKEN, b"\r")
            assert code == 0 and b'"org_id": "synthetic"' in out
            assert server.pre_auth == [None], "A login was stored before identity verification"
            prior = server.credentials.read_bytes()
            assert json.loads(prior) == {"origin": origin, "token": TOKEN}
            code, out = login(origin, config, "synthetic-rejected-secret", b"\r")
            assert code != 0 and b"401" in out
            assert server.credentials.read_bytes() == prior, "Rejected token replaced the saved login"
            code, out = login(origin, config, "synthetic-interrupted-secret", b"\x03")
            assert code != 0 and b"cancelled" in out.lower()
            assert server.pre_auth == [None, prior], "Interrupted input reached Central"
            assert server.credentials.read_bytes() == prior, "Failed or interrupted login replaced credentials"
            print("TTY login verified hidden input, validation before storage, rejection, Ctrl+C and terminal restoration.")
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
