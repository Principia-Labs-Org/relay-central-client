"""Serve disposable local A/B admin and campaign fixtures for native plugin tests."""
import hashlib
import json
from pathlib import Path
import runpy
import signal
import tempfile
import threading
import uuid


def tenant_pair(fixture, label):
    """Give a host an admin in each synthetic org and records that host can change independently."""
    from e2e import sql

    pair = {"origin": fixture.base}
    for alias, org in (("A", fixture.org), ("B", fixture.other_org)):
        token = uuid.uuid4().hex * 2
        digest = hashlib.sha256(token.encode()).hexdigest()
        sql(f"INSERT INTO users(id,org_id,name,token_hash,role) VALUES("
            f"'{uuid.uuid4()}','{org}','Fixture admin','{digest}','admin');")
        status, me, _ = fixture.request("/auth/me", token=token)
        assert status == 200 and me["org_id"] == org and me["role"] == "admin"
        body = {"name": f"{label} campaign {alias}", "objective": "Record a synthetic inquiry",
                "instructions": "Qualify the request.", "ab_enabled": False, "auto_evolve": False,
                "config": {"settings": {"assistant_name": "Fixture assistant", "language": "en"},
                           "offering": {"name": "Fixture service", "organization": "Fixture business"},
                           "ring_timeout_seconds": 19}}
        status, created, _ = fixture.request("/campaigns", body, token=token)
        assert status == 200, ("create synthetic campaign", status)
        status, detail, _ = fixture.request("/campaigns/" + created["id"], token=token)
        assert status == 200
        record = detail["campaign"]
        pair[alias] = {"token": token, "org_id": org, "campaign_id": record["id"], "campaign": record,
                       "patch": {"expected_revision": record["revision"], "name": f"{label} verified {alias}",
                                 "objective": record["objective"], "config": record["config"]}}
    return pair


def main():
    """Keep per-host credential files private until the operator ends the fixture."""
    harness = runpy.run_path(str(Path(__file__).with_name("central-e2e.py")))
    done = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: done.set())
    with harness["disposable_central"]() as fixture, tempfile.TemporaryDirectory(prefix="central-tenant-") as tmp:
        for host in ("codex", "grok", "muse"):
            path = Path(tmp) / (host + ".json")
            with path.open("x") as stream:
                path.chmod(0o600)
                json.dump(tenant_pair(fixture, host), stream)
            print(f"{host} fixture {path}", flush=True)
        print("Use a disposable host account signed in as A. Press Ctrl-C to clean up.", flush=True)
        done.wait()


if __name__ == "__main__":
    main()
