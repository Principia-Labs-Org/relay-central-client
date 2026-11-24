# Release verification

## v1.0.1 connection and guide review

The release candidate was packed with Node 22.17.1 and npm 11.6.1. Its SHA-256 was `ebca5610e8bf2ce7031aead9e2a0ecda6622eb2a7f2f238f55d141da7a270676`. The disposable Central service used the production source tree `e745545ddeda9dae673700f92de4bda58e3462b7`.

| Area reviewed | Correction and verification |
| --- | --- |
| Authentication and discovery | Environment tokens require a matching environment origin. Before sending a token, the client verifies the bearer requirement and the published identity operation. A malformed contract failed the local checks before any authenticated request. |
| Token handling and interrupted writes | CLI argument errors omit supplied values. The CLI and MCP withhold authenticated responses that reflect the active credential. A timed-out write is sent once and the caller is told to check the saved state. Sixteen Node tests and the hidden terminal login test passed. |
| Installation and guides | The guides use the tagged checkout and public references. Grok Bot requires secure secret binding and acceptance of account-wide access before token entry. Personal Muse requires a review of the connector’s destination before credential entry. The ten guides passed 224 staging and 236 production website browser tests across English, Chinese and Spanish. |
| Hosted Central | The installed CLI and MCP each passed all 15 authenticated reads in the designated dev and staging Demo organizations. Production served the 20-operation contract, and all 15 protected reads returned HTTP 401 without credentials. |

The installed CLI and MCP each completed all 20 operations. Both confirmed that A could change its own organization configuration while B’s settings and revision stayed intact. Codex 0.171.0, Claude Code, Grok Build 1.0.92 and Muse Code 1.4.25 used their native dispatchers. On each of the six surfaces A could read and update its campaign. Central denied A’s read and revision-valid edit of B’s campaign with HTTP 404. An independent B login confirmed the full record and revision were unchanged. The coding hosts used deterministic tool selection in the disposable setup. [Recorded output](v1.0.1-tenant-isolation.log)

The four consumer connection recipes each returned the expected organization and role from disposable Central over verified TLS. Claude Desktop and ChatGPT Desktop used local stdio with a saved login. Grok Bot’s command used paired process credentials with no saved login. The personal Muse recipe used direct HTTPS, fetched the schema anonymously and supplied the bearer only for the identity read at the configured origin. These checks exercised the transports with test credentials. Signed-in consumer interfaces were unavailable. [Request-level receipt](v1.0.1-consumer-connections.json) · [Public setup guides](https://docs.hellocrew.ai/clients/)

## v1.0.0 organization isolation

On November 24, 2026, the installed v1.0.0 client passed with two admin accounts belonging to different organizations in disposable Central. The npm tarball had SHA-256 `5769ce6b6ac916b9e549dc670ae1b46c4b90e94e6ea05e5e3e5d0b35cafc4fd9`. Central used source tree `e745545ddeda9dae673700f92de4bda58e3462b7`, also available at merge commit `92ac5d5a6c8f40e141b162857462dcea2f039f22`.

Each client used A's login to read and rename A's campaign and read back the change at the next revision. A received HTTP 404 on a read of B's existing campaign and an attempted edit using B's current revision. B's own login read the full campaign before and after the test and confirmed it stayed identical, including its revision. The CLI and MCP also checked both organization settings IDs against their respective staff identities, changed only A's timezone and confirmed B's full settings and revision stayed identical. [Recorded test output](tenant-isolation.log)

The CLI and MCP tests used the installed executable. Codex invoked the installed plugin through its App Server. Claude Code, Grok Build and Muse Code used their native plugin hosts with a scripted model on loopback to select tools and verify their results. Each host received A's saved login. The independent verifier held B's token.

## Reproduce the checks

Use a disposable account with Docker and a built Central checkout. Install the host software and the release's plugin under the same OS account that will run it. Keep each host on the same loopback network as the fixture. [Build and test prerequisites](../../docs/testing.md) · [Native plugin installation](../../docs/hosts.md)

To reproduce either archive, clone its release tag with `umask 022` and run `npm pack` with Node 22.17.1 and npm 11.6.1. The checkout had file modes 0644 and 0755. Compare the resulting SHA-256 with the value for that release.

```sh
export CENTRAL_CHECKOUT=/path/to/built/relay-central
export CENTRAL_CLIENT_TARBALL=/path/to/principia-labs-relay-central-client-1.0.1.tgz
sha256sum "$CENTRAL_CLIENT_TARBALL"
npm run test:e2e
python3 test/claude-plugin.py
```

The CLI, stdio MCP and Claude harnesses each handle their own synthetic logins. For Codex, Grok and Muse, first install the same tarball and start the shared fixture in a separate terminal.

```sh
npm install --global --ignore-scripts "$CENTRAL_CLIENT_TARBALL"
python3 test/tenant_fixture.py
```

The fixture prints a private file path for each host. In the disposable OS account used by the host, run the following once per host with the corresponding path. The token goes to the login command's standard input.

```sh
host=codex  # Repeat for grok and muse.
fixture=/path/printed/for/this/host.json
unset CENTRAL_ORIGIN CENTRAL_TOKEN
jq -r .A.token "$fixture" | relay-central login --origin "$(jq -r .origin "$fixture")" --token-stdin
case "$host" in
  codex) python3 test/codex-plugin.py --tenant-fixture "$fixture" ;;
  grok|muse) python3 test/grok-muse-plugin.py "$host" --tenant-fixture "$fixture" ;;
esac
relay-central logout
```

Each host needs its own fresh campaign pair because an approved edit advances the revision. Stop the fixture with Ctrl-C to remove the database and credential files.
