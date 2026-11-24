"""Verify native host tool results against two synthetic organizations in local Central."""
from dataclasses import dataclass
from http.client import HTTPConnection
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Case:
    name: str
    tool: str
    arguments: dict


class TenantCheck:
    """Accept the private JSON file or dict produced by tenant_fixture.tenant_pair."""

    def __init__(self, fixture):
        if isinstance(fixture, dict):
            pair = fixture
        elif str(fixture) == "-":
            pair = json.load(sys.stdin)
        else:
            pair = json.loads(Path(fixture).read_text())
        self.origin = pair["origin"]
        origin = urlsplit(self.origin)
        if (origin.scheme != "http" or origin.hostname not in ("127.0.0.1", "localhost", "::1")
                or origin.username is not None or origin.password is not None
                or origin.path not in ("", "/") or origin.query or origin.fragment):
            raise ValueError("Native write tests require a disposable loopback Central origin.")
        self._a, self._b = pair["A"], pair["B"]
        self._tokens = (self._a["token"].encode(), self._b["token"].encode())
        assert all(self._a[k] != self._b[k] for k in ("org_id", "token", "campaign_id"))
        self._position = 0
        for account in (self._a, self._b):
            record, patch = account["campaign"], account["patch"]
            assert (record["org_id"], record["id"]) == (account["org_id"], account["campaign_id"])
            assert patch == {"name": patch["name"], "config": record["config"], "objective": record["objective"],
                             "expected_revision": record["revision"]} and patch["name"] != record["name"]
        self._identity = self._read(self._a, "/auth/me")
        assert self._identity["org_id"] == self._a["org_id"] and self._identity["role"] == "admin"
        b_identity = self._read(self._b, "/auth/me")
        assert b_identity["org_id"] == self._b["org_id"] and b_identity["role"] == "admin"
        self._b_path = "/campaigns/" + self._b["campaign_id"]
        self._b_before = self._read(self._b, self._b_path)
        assert self._b_before["campaign"] == self._b["campaign"], "B campaign changed before the test"
        a_id, b_id = self._a["campaign_id"], self._b["campaign_id"]
        self.cases = (
            Case("A identity", "staffMe", {}),
            Case("A campaign", "campaign", {"id": a_id}),
            Case("A update", "updateCampaign", {"id": a_id, "body": self._a["patch"]}),
            Case("A readback", "campaign", {"id": a_id}),
            Case("B read denied", "campaign", {"id": b_id}),
            Case("B update denied", "updateCampaign", {"id": b_id, "body": self._b["patch"]}),
        )

    def includes_token(self, *parts):
        return any(token in part for token in self._tokens for part in parts)

    def _read(self, account, path):
        origin = urlsplit(self.origin)
        connection = HTTPConnection(origin.hostname, origin.port, timeout=10)
        try:
            connection.request("GET", "/api" + path, headers={"Authorization": "Bearer " + account["token"]})
            response = connection.getresponse()
            assert response.status == 200, f"Independent fixture read returned HTTP {response.status}"
            return json.load(response)
        finally:
            connection.close()

    def verify(self, case, result, is_error=False):
        """Pass a decoded success object or a tool error string (is_error=True)."""
        assert self.cases[self._position] == case, "Native tool results arrived out of order"
        if case.name in ("B read denied", "B update denied"):
            assert is_error and isinstance(result, str) and re.search(r"Central returned HTTP 404\b", result), case.name
        else:
            assert not is_error and isinstance(result, dict), case.name
            a = self._a
            if case.name == "A identity":
                assert result == self._identity, "Host must use fixture A's admin identity before any write"
            elif case.name == "A campaign":
                assert result["campaign"] == a["campaign"], case.name
            else:
                record = result if case.name == "A update" else result["campaign"]
                assert record == {**a["campaign"], "name": a["patch"]["name"],
                                  "revision": a["campaign"]["revision"] + 1}, case.name
        self._position += 1

    def finish(self):
        assert self._position == len(self.cases), "Missing native tool results"
        assert self._read(self._b, self._b_path) == self._b_before, "B's campaign changed after the denied update"
