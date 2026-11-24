"""Exercise the installed npm tarball through both transports against disposable Central."""
import concurrent.futures
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = Path(os.environ.get("CENTRAL_CHECKOUT", ROOT.parent / "relay-central")).resolve()
PREPACKED = Path(os.environ["CENTRAL_CLIENT_TARBALL"]).resolve() if os.environ.get("CENTRAL_CLIENT_TARBALL") else None


def installed_cli(directory):
    archive = PREPACKED
    if archive is None:
        packed = subprocess.check_output(["npm", "pack", "--json", "--pack-destination", directory],
                                         cwd=ROOT, text=True)
        archive = directory / json.loads(packed)[0]["filename"]
    print(f"Tarball SHA-256 {hashlib.sha256(archive.read_bytes()).hexdigest()}", flush=True)
    prefix = directory / "installed"
    subprocess.run(["npm", "install", "--prefix", prefix, "--ignore-scripts", "--no-audit",
                    "--no-fund", archive], check=True)
    binary = prefix / "node_modules/.bin/relay-central"
    package = binary.resolve().parents[1]
    for path in (".agents/plugins/marketplace.json", ".claude-plugin/marketplace.json",
                 "plugins/relay-central/.claude-plugin/plugin.json", "plugins/relay-central/.mcp.json"):
        assert (package / path).is_file(), f"Missing plugin file in installed tarball: {path}"
    for document in [package / "README.md", *sorted((package / "docs").glob("*.md"))]:
        for link in re.findall(r"\]\(([^)\s]+)\)", document.read_text()):
            target = urlsplit(link)
            if target.path and not target.scheme and not target.netloc:
                assert (document.parent / unquote(target.path)).exists(), f"Broken installed link in {document.name}: {link}"
    return binary


@contextlib.contextmanager
def disposable_db():
    name = "central-client-e2e-" + uuid.uuid4().hex
    subprocess.run(["docker", "run", "--detach", "--rm", "--name", name,
                    "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data",
                    "--env", "POSTGRES_USER=client_test", "--env", "POSTGRES_PASSWORD=disposable",
                    "postgres:16-bookworm"], check=True, stdout=subprocess.DEVNULL)
    try:
        for _ in range(120):
            if subprocess.run(["docker", "exec", name, "pg_isready", "-U", "client_test", "-h", "127.0.0.1"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.5)
        else:
            raise RuntimeError("Disposable Postgres did not become ready")
        address = subprocess.check_output(["docker", "port", name, "5432/tcp"], text=True).strip()
        host, port = address.split(":")
        assert host == "127.0.0.1"
        yield f"postgres://client_test:disposable@{host}:{int(port)}/client_test"
    finally:
        subprocess.run(["docker", "rm", "-f", name], check=True, stdout=subprocess.DEVNULL)


class Client:
    def __init__(self, binary, fixture, config, mode):
        self.binary, self.fixture, self.config, self.mode = binary, fixture, config, mode
        self.used = set()

    def command(self, args, *, stdin=None, token=None):
        env = {**os.environ, "XDG_CONFIG_HOME": str(self.config)}
        if token is not None:
            env.update(CENTRAL_ORIGIN=self.fixture.base, CENTRAL_TOKEN=token)
        return subprocess.run([self.binary, *args], input=stdin, capture_output=True, text=True,
                              cwd=self.config.parent, env=env, timeout=30)

    def call(self, name, *, token=None, expected=None, **arguments):
        command = (["mcp"] if self.mode == "mcp" else []) + ["call", name, "--json", "-"]
        result = self.command(command, stdin=json.dumps(arguments), token=token)
        if expected:
            assert result.returncode and re.search(expected, result.stderr, re.I), (name, expected, result.stderr)
            return
        assert result.returncode == 0, (name, result.stderr)
        self.used.add(name)
        return json.loads(result.stdout)

    def tool_names(self, token=None):
        args = ["mcp", "list"] if self.mode == "mcp" else ["tools"]
        result = self.command(args, token=token)
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        return {tool["name"] for tool in payload}


def seed(fixture, phone):
    from e2e import sql
    ids = {name: str(uuid.uuid4()) for name in ("reader", "contact", "foreign", "request", "incoming", "call")}
    reader_token = uuid.uuid4().hex * 2
    digest = hashlib.sha256(reader_token.encode()).hexdigest()
    campaign = fixture.campaign()
    org = fixture.org
    sql(f"""INSERT INTO users(id,org_id,name,token_hash,role)
              VALUES('{ids["reader"]}','{org}','Fixture reader','{digest}','viewer');
            INSERT INTO contacts(id,org_id,phone) VALUES('{ids["contact"]}','{org}','{phone}'),
              ('{ids["foreign"]}','{fixture.other_org}','{phone}');
            INSERT INTO requests(id,business_id,kind,customer,details,submission_key)
              VALUES('{ids["request"]}','{org}','quote','{{"name":"Fixture guest"}}','{{}}','{ids["request"]}');
            INSERT INTO inbound_calls(id,org_id,session_id,worker_id,caller,destination,complete)
              VALUES('{ids["incoming"]}','{org}','{ids["incoming"]}','local','{phone}','+12025550100',true);
            INSERT INTO calls(id,org_id,campaign_id,guidance_id,variant,prospect_key,idempotency_key,
                request,relay_request,is_test,created_by,state,outcome,evidence)
              VALUES('{ids["call"]}','{org}','{campaign["id"]}','{campaign["baseline_id"]}',
              'baseline','fixture','{ids["call"]}','{{}}','{{}}',false,'{fixture.user}','ended','yes','{{}}');""")
    return reader_token, ids, campaign["id"]


def exercise(client, phone_number):
    f, call = client.fixture, client.call
    reader, ids, campaign_id = seed(f, phone_number)
    login = client.command(["login", "--origin", f.base, "--token-stdin"], stdin=f.token + "\n")
    assert login.returncode == 0 and f.token not in login.stdout + login.stderr, "login failed or echoed token"
    assert client.command(["whoami"]).returncode == 0
    assert call("staffMe")["org_id"] == f.org
    assert call("staffMe", token=reader)["role"] == "viewer"
    call("staffMe", token=uuid.uuid4().hex * 2, expected=r"\b401\b")
    tools = client.tool_names()
    viewer_tools = client.tool_names(reader)
    assert len(tools) == 20 and "updateOrganizationConfiguration" not in viewer_tools
    assert "getCampaignMetrics" in viewer_tools
    assert "assistant_name" in call("getConfigurationSchema")["settings"]["properties"]
    before = call("getOrganizationConfiguration")
    edit = "updateOrganizationConfiguration"
    zones = [z for z in ("UTC", "EDT", "America/Chicago") if z != before["work_queue_timezone"]]
    bodies = [{"expected_revision": before["revision"], "work_queue_timezone": z} for z in zones[:2]]
    call(edit, token=reader, expected=r"403|role|unavailable", body=bodies[0])
    assert f.request("/organization", bodies[0], method="PATCH", token=reader, origin=False)[0] == 403
    # Both independent installed processes submit the same observed revision.
    args = (["mcp"] if client.mode == "mcp" else []) + ["call", edit, "--json", "-"]
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda b: client.command(args, stdin=json.dumps({"body": b})), bodies))
    winner, = [p for p in results if p.returncode == 0]
    rejected, = [p for p in results if p.returncode != 0]
    assert "409" in rejected.stderr, rejected.stderr
    client.used.add(edit)
    saved = json.loads(winner.stdout)
    assert saved["work_queue_timezone"] in zones[:2]
    assert saved == {**before, "revision": before["revision"] + 1, "work_queue_timezone": saved["work_queue_timezone"]}
    assert call("getOrganizationConfiguration") == saved
    audit = call("getConfigurationAudit")["events"][0]
    assert audit["revision_after"] == saved["revision"] and audit["changed_fields"] == ["/work_queue_timezone"]

    f.phone()
    assert call("inboundNumbers")["numbers"]
    phone = call("phoneConfiguration")
    phone["expected_revision"] = phone.pop("revision")
    phone["inbound"]["settings"]["assistant_name"] = "Fixture client"
    updated = call("savePhoneConfiguration", body=phone)
    assert updated["outbound"] == phone["outbound"] and updated == call("phoneConfiguration")
    intake = call("intakeConfiguration")
    intake["expected_revision"] = intake.pop("revision")
    intake["pricing_notes"] = "Qualification through " + client.mode
    updated = call("saveIntakeConfiguration", body=intake)
    assert updated["pricing_notes"] == intake["pricing_notes"] and updated == call("intakeConfiguration")
    assert campaign_id in [c["id"] for c in call("campaigns", token=reader)["campaigns"]]
    campaign = call("campaign", id=campaign_id)["campaign"]
    body = {"name": "Updated demo", "objective": campaign["objective"], "config": campaign["config"],
            "expected_revision": campaign["revision"]}
    assert call("updateCampaign", id=campaign_id, body=body)["revision"] == campaign["revision"] + 1
    report = call("getCampaignMetrics", id=campaign_id, limit=1, token=reader)
    assert (report["total_calls"], report["live"]["arms"]["baseline"]["attempts"],
            report["practice"]["arms"]["baseline"]["attempts"]) == (1, 1, 0)
    call("getCampaignMetrics", id=campaign_id, token=f.other_token, expected=r"\b404\b")
    for token, target in ((reader, ids["contact"]), (f.other_token, ids["foreign"])):
        contacts = call("listContacts", phone=phone_number, limit=1, offset=0, token=token)
        assert [c["id"] for c in contacts["contacts"]] == [target]
    incoming = call("inboundCalls", token=reader)["calls"]
    assert any(row["id"] == ids["incoming"] and row["caller"] == phone_number for row in incoming)
    request = call("intakeRequest", id=ids["request"], token=reader)
    assert [request] == call("intakeRequests", submission_key=ids["request"], token=reader)["requests"]
    call("intakeRequest", id=ids["request"], token=f.other_token, expected=r"\b404\b")
    queue = call("staffWorkQueue", view="new", token=reader)
    item = next(row for row in queue["items"] if row["id"] == "request:" + ids["request"])
    action = {"status": "working", "expected_version": item["version"]}
    assert "progressStaffWork" not in viewer_tools
    f.api("/staff/" + ids["reader"], {"role": "operator"}, method="PATCH")
    assert "progressStaffWork" in client.tool_names(reader)
    assert call("progressStaffWork", id=item["id"], token=reader, body=action)["status"] == "working"
    call("progressStaffWork", id=item["id"], token=reader, body=action, expected=r"\b409\b")
    assert call("intakeRequest", id=ids["request"])["status"] == "accepted"
    assert client.used == tools, tools - client.used
    assert client.command(["logout"]).returncode == 0 and client.command(["whoami"]).returncode != 0
    print(f"{client.mode}: all {len(tools)} operations passed, including tenant isolation and concurrent revisions", flush=True)


def check_tenant_isolation(client, pair):
    own, other = pair["A"], pair["B"]
    login = client.command(["login", "--origin", client.fixture.base, "--token-stdin"], stdin=own["token"] + "\n")
    assert login.returncode == 0 and own["token"] not in login.stdout + login.stderr
    assert client.call("staffMe")["org_id"] == own["org_id"]
    assert client.call("staffMe", token=other["token"])["org_id"] == other["org_id"]
    assert own["org_id"] != other["org_id"]
    config = "getOrganizationConfiguration"
    before_a = client.call(config)
    before_b = client.call(config, token=other["token"])
    assert (before_a["id"], before_b["id"]) == (own["org_id"], other["org_id"])
    timezone = "UTC" if before_a["work_queue_timezone"] != "UTC" else "America/Chicago"
    expected = {**before_a, "work_queue_timezone": timezone, "revision": before_a["revision"] + 1}
    assert client.call("updateOrganizationConfiguration",
                       body={"work_queue_timezone": timezone, "expected_revision": before_a["revision"]}) == expected
    assert client.call(config) == expected
    assert client.call(config, token=other["token"]) == before_b
    assert client.call("campaign", id=own["campaign_id"])["campaign"] == own["campaign"]
    before = client.call("campaign", id=other["campaign_id"], token=other["token"])["campaign"]
    assert before == other["campaign"] and before["revision"] == other["patch"]["expected_revision"]
    client.call("campaign", id=other["campaign_id"], expected=r"\b404\b")
    client.call("updateCampaign", id=other["campaign_id"], body=other["patch"], expected=r"\b404\b")
    updated = client.call("updateCampaign", id=own["campaign_id"], body=own["patch"])
    assert updated["name"] == own["patch"]["name"] and updated["revision"] == own["campaign"]["revision"] + 1
    assert client.call("campaign", id=own["campaign_id"])["campaign"] == updated
    after = client.call("campaign", id=other["campaign_id"], token=other["token"])["campaign"]
    assert after == before
    assert client.command(["logout"]).returncode == 0
    print(json.dumps({"transport": client.mode, "A_reads_A": 200, "A_updates_A": 200,
                      "own_org_configs_match_token_identities": True,
                      "A_org_config_updated_and_read_back": True, "B_org_config_unchanged_including_revision": True,
                      "A_reads_B": 404, "A_updates_B_with_current_revision": 404,
                      "B_reads_B": 200, "B_unchanged_including_revision": True}), flush=True)


@contextlib.contextmanager
def disposable_central():
    """Start Central on loopback against a fresh synthetic database."""
    if not (CHECKOUT / "target/debug/relay-central").is_file():
        raise SystemExit("Set CENTRAL_CHECKOUT to a Central checkout built with cargo build --locked --bin relay-central")
    # Central's optional live flags, real service keys and dotfiles stay outside the fixture process.
    sys.path.insert(0, str(CHECKOUT / "scripts"))
    from verify_local import clean_environment
    clean = clean_environment()
    os.environ.clear()
    os.environ.update(clean)
    with disposable_db() as db:
        os.environ["TEST_DATABASE_URL"] = db
        sys.path.insert(0, str(CHECKOUT / "tests"))
        from admin_configuration_e2e import Administration
        fixture = Administration()
        fixture.setUpClass()
        try:
            yield fixture
        finally:
            fixture.tearDownClass()


def main():
    from tenant_fixture import tenant_pair
    with disposable_central() as fixture, tempfile.TemporaryDirectory(prefix="central-client-e2e-") as tmp:
        directory = Path(tmp)
        binary = installed_cli(directory)
        for mode, phone in (("cli", "+12025550147"), ("mcp", "+12025550149")):
            client = Client(binary, fixture, directory / "config", mode)
            exercise(client, phone)
            check_tenant_isolation(client, tenant_pair(fixture, mode))


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(1))
    main()
