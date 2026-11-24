# Install the Relay Central plugin

Install the `relay-central` executable and run `relay-central login` once from the same OS account that runs your agent. The host launches `relay-central mcp` on its own PATH and uses that saved login. Keep the token in the login prompt or your secret store. [CLI installation and login](../README.md)

## Codex

```sh
codex plugin marketplace add Principia-Labs-Org/relay-central-client
codex plugin add relay-central@relay-platform
codex mcp get relay-central
```

Start a new Codex session. Ask it to use the Relay Central `staffMe` tool to identify your organization and role. For a local checkout, pass its absolute path to `codex plugin marketplace add`. [Codex plugin guide](https://developers.openai.com/plugins/build/plugins)

## Claude Code

```sh
claude plugin marketplace add Principia-Labs-Org/relay-central-client
claude plugin install relay-central@relay-platform
claude mcp list
```

The MCP health check should show `plugin:relay-central:relay-central` as connected. A local checkout also works as the marketplace source. [Claude Code plugin documentation](https://code.claude.com/docs/en/plugins/manifest-reference)

## Grok Build

From the repository checkout, install the plugin directory you reviewed. The trust step enables its local MCP process.

```sh
grok plugin validate ./plugins/relay-central
grok plugin install ./plugins/relay-central --trust
grok mcp doctor relay-central
```

The doctor reports the stdio handshake and the number of discovered tools. [Grok Build plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces)

## Muse Code

From the repository checkout, add the marketplace, install the plugin, and approve its MCP capability.

```sh
muse plugins marketplace add relay-platform .
muse plugins install relay-central@relay-platform
muse plugins approve relay-central:mcp_server:relay-central
muse plugins inspect relay-central
```

Start a new session in a trusted workspace. Muse Code loads the approved tools at session startup. These instructions apply to the local Muse Code host. [Muse Code plugin CLI](https://meta-models.github.io/muse-code-sdk/1.4/guides/plugins/reference/cli/)

## Check a first read

Ask your agent to call `staffMe`, then show the signed-in organization and role. Try listing up to five Work Queue items, or ask for a campaign's measured live and practice results. For changes, ask it to read the current configuration first and show the exact fields it will send. Tool availability follows your token's role.

If a host reports a missing executable, run `relay-central --version` in its launch environment and restart it after updating PATH. If a login changes during a session, reconnect the MCP server so the next call uses the intended account.


For repeatable native host checks, see [host verification](testing.md#verify-host-integration).
