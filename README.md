# Relay Central client

Use your organization token to configure Relay Central, retrieve records, update the Work Queue and read campaign analytics. The CLI and MCP server discover operation names, arguments and minimum roles from the Central installation you log in to. [Production OpenAPI](https://central.hellocrew.ai/openapi/agent.json)

## Install and sign in

Choose your app for a copyable setup prompt.

| Where you work | Setup guides |
| --- | --- |
| Desktop and personal apps | [Grok Bot](https://docs.hellocrew.ai/clients/grok-bot/) · [Meta Muse (personal)](https://docs.hellocrew.ai/clients/muse-personal/) · [Claude Desktop](https://docs.hellocrew.ai/clients/claude-desktop/) · [ChatGPT Desktop](https://docs.hellocrew.ai/clients/chatgpt-desktop/) |
| Coding agents | [Codex](https://docs.hellocrew.ai/clients/codex/) · [Claude Code](https://docs.hellocrew.ai/clients/claude/) · [Grok Build](https://docs.hellocrew.ai/clients/grok/) · [Muse Code](https://docs.hellocrew.ai/clients/muse/) |
| Terminal and other MCP hosts | [CLI](https://docs.hellocrew.ai/clients/cli/) · [MCP](https://docs.hellocrew.ai/clients/mcp/) |

For CLI and local MCP setups, use Node.js 22 or newer and install the tagged client on the computer that will run it. For Grok Bot this is the Bot’s computer. Personal Muse connects directly to the Central API through a Custom Connector. [Host-specific instructions](docs/hosts.md)

```sh
git clone --branch v1.0.0 --depth 1 https://github.com/Principia-Labs-Org/relay-central-client.git
cd relay-central-client
npm ci
npm link
relay-central login --origin https://central.hellocrew.ai
relay-central whoami
```

Get your existing organization API token from the person who provisioned your HelloCrew account or your organization's secret manager. Enter it in the hidden prompt in your own terminal. Login verifies the token and reports the organization and role before replacing your saved login. Check that both match the account you intend to use. Production is the default origin. Use your staging origin to select staging.

For a token provided by a secret manager or a protected file, use stdin.

```sh
relay-central login --origin https://staging.central.hellocrew.ai --token-stdin < /private/path/to/token
```

The client stores one origin and token together under `$XDG_CONFIG_HOME/relay-central-client/credentials.json` (default `~/.config/relay-central-client/credentials.json`). On POSIX systems the directory and file use modes 0700 and 0600. `relay-central logout` removes the local file. Token revocation belongs to Central. For ephemeral automation, supply both `CENTRAL_ORIGIN` and `CENTRAL_TOKEN` in the process environment. They take precedence over the saved login.

## Use the CLI

```sh
relay-central tools
relay-central describe staffWorkQueue
relay-central call staffWorkQueue --json '{"view":"new","limit":5}'
relay-central call campaigns
relay-central call getCampaignMetrics --json '{"id":"<campaign-id>","limit":100}'
```

Commands return JSON on stdout. Failures use stderr and a nonzero exit code. Pass path and query fields by their published names. Put the JSON request payload under `body`. Use `--json -` to read arguments from a pipe or file.

For example, an administrator can change the Work Queue time zone by reading the organization settings, confirming the intended change and using the revision just read.

```sh
relay-central call getOrganizationConfiguration
# Substitute the revision you just read for 7.
relay-central call updateOrganizationConfiguration --json '{"body":{"expected_revision":7,"work_queue_timezone":"UTC"}}'
relay-central call getOrganizationConfiguration
```

On HTTP 409, reload the record and reassess the change. For a lost write response, check the saved state before retrying. When editing phone, intake or campaign configuration, preserve the other fields required by the operation. [Central configuration examples](https://github.com/Principia-Labs-Org/relay-central/blob/main/docs/organization-api.md)

## Use it with an agent

Install the host plugin after signing in. Codex, Claude Code, Grok Build and Muse Code share the same server executable and login. [Host installation and verification](docs/hosts.md)

For an MCP host with a custom stdio server setting, use command `relay-central` and argument `mcp`. Make sure the host can find the installed executable on its PATH. The server reads the token in its own process. The model sees operation arguments and results. Reconnect the host after switching accounts or changing roles.

The CLI includes an MCP client for inspecting or calling the same tools through the stdio protocol.

```sh
relay-central mcp list
relay-central mcp call staffMe
relay-central mcp call staffWorkQueue --json '{"view":"new","limit":5}'
```

The publication and regression workflow uses the installed package against disposable Central and PostgreSQL. [Run the tests](docs/testing.md)

The v1.0.0 two-organization tests cover the CLI, MCP, Codex, Claude Code, Grok Build and Muse Code. Organization A can update its campaign. Central returns HTTP 404 for A's read and revision-valid edit of B's campaign, and B's own token confirms its record and revision are intact. The four desktop and personal app guides describe vendor-documented connection methods. Signed-in end-to-end checks in those four interfaces are pending. [Tenant isolation evidence and reproduction](test/evidence/README.md)
