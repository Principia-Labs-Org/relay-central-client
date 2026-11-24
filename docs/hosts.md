# Connect your agent to Relay Central

For a local MCP host on your own computer, install the tagged client and run `relay-central login` in your own terminal with the same OS account and configuration directory the host uses. The launch command is `relay-central` with one argument, `mcp`. The server uses the saved login when both `CENTRAL_TOKEN` and `CENTRAL_ORIGIN` are unset. For a managed Grok Bot or personal Muse, follow the credential steps for that app below. [CLI installation and login](../README.md#install-and-sign-in)

## Desktop and personal apps

The following routes use each vendor’s documented connection features. Signed-in end-to-end checks in these four interfaces are pending. The installed-client release tests exercise the CLI, MCP, Codex, Claude Code, Grok Build and Muse Code. [Release evidence](https://github.com/Principia-Labs-Org/relay-central-client/blob/v1.0.1/test/evidence/README.md)

### Grok Bot

1. Check who can use this connection first. Grok shares the computer and command connectors across all Bots on the account. Proceed only if all of them may use this Central role and your connector can bind a secure secret to its command process. Grok documents secure secret storage. A secret card alone does not establish that the command can receive it.
2. Install the tagged CLI on the **Bot’s computer** using the clone and npm steps in the README. Skip CLI login on the shared computer. Bind the secret as `CENTRAL_TOKEN` and set `CENTRAL_ORIGIN` to `https://central.hellocrew.ai` for that same process. Enter the token only through Grok’s secure secret card. If secure process binding is unavailable, stop before entering a credential.
3. In the desktop app open **Connect apps → Add a custom connector**. Choose **Command**, name it **Relay Central**, set the command to the installed executable and enter `mcp` as its only argument. Choose **Add plugin**, attach the connector to a new message and ask it to call `staffMe`. Confirm the organization and role. [Grok Bot setup prompt](https://docs.hellocrew.ai/clients/grok-bot/) · [Grok Bot custom connectors](https://docs.x.ai/grok-bot/computer-and-apps) · [Grok Bot secrets](https://docs.x.ai/grok-bot/vault)

### Meta Muse (personal)

Paste this request into personal Muse to create a **Custom Connector** that calls Central’s API directly.

> Create a Relay Central Custom Connector using https://central.hellocrew.ai/openapi/agent.json. Fetch the schema without credentials. Before requesting a token, show me the connector’s destination and authentication settings. Limit authenticated requests to https://central.hellocrew.ai, disable redirects and use an Authorization: Bearer header. If Muse cannot enforce those settings or offer secure credential entry, stop. Once I confirm, let me enter my organization token in Muse’s secure form. Call staffMe (GET /api/auth/me), show my organization and role, and stop after that read.

Enter the token in Muse’s secure credential form. If Muse asks for the value in ordinary chat, pause setup. You can manage the connection in **Settings → Connectors**. [Personal Muse setup prompt](https://docs.hellocrew.ai/clients/muse-personal/) · [Meta’s connector guide](https://www.meta.com/en-gb/help/superintelligence/1687253048996149/)

### Claude Desktop

1. Install the CLI and sign in on the desktop computer. Open Claude Desktop’s **Settings → Developer → Edit Config**.
2. Add an entry named `relay-central` under `mcpServers`. Preserve existing entries. This configuration works when the executable is on Claude’s PATH.

   ```json
   {
     "mcpServers": {
       "relay-central": {"command": "relay-central", "args": ["mcp"]}
     }
   }
   ```

3. Fully quit and reopen Claude Desktop. Ask Claude to call `staffMe` and show your organization and role. If Claude cannot find the program, use an absolute path to Node as `command`. Supply the absolute path to `bin/relay-central.js` in your checkout and then `mcp` as the two arguments. [Claude Desktop setup prompt](https://docs.hellocrew.ai/clients/claude-desktop/) · [Claude Desktop local MCP configuration](https://modelcontextprotocol.io/docs/develop/connect-local-servers)

### ChatGPT Desktop

1. Install the CLI and sign in on the desktop computer. In ChatGPT Desktop open **Settings → MCP servers → Add server**. Choose **STDIO**, name it `relay-central`, set the command to the installed executable and enter `mcp` as its only argument.
2. Select **Save**, then **Restart**. Start a **local Codex** thread in the desktop app. Type `/mcp` to check the connected servers, then ask it to call `staffMe` and show your organization and role.

This connection runs on your computer. Cloud chats require a separately configured web-compatible plugin and authorization. [ChatGPT Desktop setup prompt](https://docs.hellocrew.ai/clients/chatgpt-desktop/) · [OpenAI’s MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp#connect-codex-to-an-mcp-server)

For a workspace plugin usable in an eligible local ChatGPT thread, a workspace admin can open **Admin Console → Plugins → Add → Import marketplace**. Enter `https://github.com/Principia-Labs-Org/relay-central-client`, leave the marketplace path empty and select the tag `v1.0.1`. Review the import results and access for the intended roles. Each user still needs the client installed and signed in on their computer. If the workspace offers the plugin in a local desktop thread, install it, start a new thread and ask it to call `staffMe`. [OpenAI marketplace import](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github) · [ChatGPT plugin availability](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)

## Coding agent plugins

### Codex

From the tagged client checkout, run the following in a shell that supports `$PWD`. You can also substitute the absolute path to that checkout.

```sh
codex plugin marketplace add "$PWD"
codex plugin add relay-central@relay-platform
codex mcp get relay-central
```

Start a new Codex session. Ask it to use the Relay Central `staffMe` tool to identify your organization and role. [Codex plugin guide](https://developers.openai.com/plugins/build/plugins)

### Claude Code

Use the absolute path to the same tagged checkout as the marketplace source.

```sh
claude plugin marketplace add "$PWD"
claude plugin install relay-central@relay-platform
claude mcp list
```

The MCP health check should show `plugin:relay-central:relay-central` as connected. [Claude Code plugin documentation](https://code.claude.com/docs/en/plugins/manifest-reference)

### Grok Build

From the repository checkout, install the plugin directory you reviewed. The trust step enables its local MCP process.

```sh
grok plugin validate ./plugins/relay-central
grok plugin install ./plugins/relay-central --trust
grok mcp doctor relay-central
```

The doctor reports the stdio handshake and the number of discovered tools. [Grok Build plugins](https://docs.x.ai/build/features/skills-plugins-marketplaces)

### Muse Code

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

For repeatable coding agent checks, see [host verification](testing.md#verify-host-integration).
