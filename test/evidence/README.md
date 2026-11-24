# Organization isolation in v1.0.0

On November 24, 2026, the installed v1.0.0 client passed with two admin accounts belonging to different organizations in disposable Central. The npm tarball had SHA-256 `5769ce6b6ac916b9e549dc670ae1b46c4b90e94e6ea05e5e3e5d0b35cafc4fd9`. Central used source tree `e745545ddeda9dae673700f92de4bda58e3462b7`, also available at merge commit `92ac5d5a6c8f40e141b162857462dcea2f039f22`.

Each client used A's login to read and rename A's campaign and read back the change at the next revision. A received HTTP 404 on a read of B's existing campaign and an attempted edit using B's current revision. B's own login read the full campaign before and after the test and confirmed it stayed identical, including its revision. The CLI and MCP also checked both organization settings IDs against their respective staff identities, changed only A's timezone and confirmed B's full settings and revision stayed identical. [Recorded test output](tenant-isolation.log)

The CLI and MCP tests used the installed executable. Codex invoked the installed plugin through its App Server. Claude Code, Grok Build and Muse Code used their native plugin hosts with a scripted model on loopback to select tools and verify their results. Each host received A's saved login. The independent verifier held B's token.

## Reproduce the checks

Use a disposable account with Docker and a built Central checkout. Install the host software and the release's plugin under the same OS account that will run it. Keep each host on the same loopback network as the fixture. [Build and test prerequisites](../../docs/testing.md) · [Native plugin installation](../../docs/hosts.md)

To reproduce the archive, clone the tag with `umask 022` and run `npm pack` with Node 22.17.1 and npm 11.6.1. The checkout had file modes 0644 and 0755. Compare the resulting SHA-256 with the value above.

```sh
export CENTRAL_CHECKOUT=/path/to/built/relay-central
export CENTRAL_CLIENT_TARBALL=/path/to/principia-labs-relay-central-client-1.0.0.tgz
sha256sum "$CENTRAL_CLIENT_TARBALL"
npm run test:e2e
python3 test/claude-plugin.py
```

The CLI, stdio MCP and Claude harnesses each handle their own synthetic logins. For Codex, Grok and Muse, first install the same tarball and start the shared fixture in a separate terminal.

```sh
npm install --global "$CENTRAL_CLIENT_TARBALL"
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
