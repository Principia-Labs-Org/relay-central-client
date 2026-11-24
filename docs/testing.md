# Verify the installed client

Run the following commands from a checkout of the public client repository using Node 22 or newer. The test harnesses live in the checkout. [Client repository](https://github.com/Principia-Labs-Org/relay-central-client)

```sh
npm ci
npm test
python3 test/tty-login.py
```

The end-to-end test builds an npm tarball and installs it in a temporary directory. It signs in through the installed CLI and exercises the same 20 organization operations through HTTP and an MCP SDK client connected to the installed stdio server.

For this test, use a checkout of Relay Central with its organization API and test fixtures (commit `92ac5d5` or a compatible revision). Build its debug binary first. The test needs Docker, the PostgreSQL `psql` client and Python 3 with `cryptography` and `jsonschema`.

```sh
export CENTRAL_CHECKOUT=/path/to/relay-central
(cd "$CENTRAL_CHECKOUT" && cargo build --locked --bin relay-central)
npm run test:e2e
```

To verify an existing release tarball, set `CENTRAL_CLIENT_TARBALL` to its local path before running the same command. The test prints its SHA-256.

The test starts a loopback Postgres 16 container with temporary storage and runs Central with synthetic organization, staff and provider fixtures. It checks login and logout, role-based discovery, tenant isolation, contact and request retrieval, campaign metrics, configuration edits and Work Queue updates. Two writers use the same organization revision. Exactly one succeeds and Central returns 409 to the other. The temporary login, server and database are removed on exit.

For a manual GitHub Actions run, configure `CENTRAL_READ_TOKEN` with read access to the private Central repository and dispatch **Verify installed client**. It checks out the qualified Central revision, builds it and runs the same installed-package E2E. When changing the supported API baseline, qualify the new Central revision locally and update the workflow pin.

## Verify host integration

From a client repository checkout, the following optional checks exercise each host's own tool dispatcher. Run the Codex, Grok and Muse checks with a synthetic organization login. Codex calls `staffMe` directly through its app server. Grok and Muse send a scripted tool request from a loopback model endpoint and verify the identity returned to that endpoint. The Claude test installs the plugin and packaged CLI with a disposable organization and verifies a configuration read through a loopback model endpoint.

```sh
python3 test/codex-plugin.py
python3 test/grok-muse-plugin.py grok
python3 test/grok-muse-plugin.py muse
CENTRAL_CHECKOUT=/path/to/built/relay-central python3 test/claude-plugin.py
```

Muse Code needs a trusted workspace to activate the plugin during these tests. The Muse check creates a temporary workspace and trusts it for that run.
