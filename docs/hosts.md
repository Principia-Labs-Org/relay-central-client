# Connect your agent to Relay Central

For a local MCP connection, install the client and run `relay-central login` from the OS account that will launch the server. The launch command is `relay-central` with one argument, `mcp`. The server uses the login saved on that computer. Enter the token at the hidden terminal prompt or through the host’s secure credential mechanism. [CLI installation and login](../README.md#install-and-sign-in)

## Desktop and personal apps

The following routes use each vendor’s documented connection features. Signed-in end-to-end checks in these four interfaces are pending. The v1.0.0 release exercised the CLI, MCP, Codex, Claude Code, Grok Build and Muse Code. [Release evidence](../test/evidence/README.md)

### Grok Bot

1. Install the tagged CLI on **the Bot’s computer**. When you control a terminal on that computer, run `relay-central login --origin https://central.hellocrew.ai` and enter the organization token at its hidden prompt. If your Bot supports passing a secure secret to the connector process, supply the token as `CENTRAL_TOKEN` through Grok’s secure secret card and set `CENTRAL_ORIGIN` to `https://central.hellocrew.ai` for the connector process. Keep the token out of chat, commands and connector arguments.
2. In Grok Bot’s desktop app, open **Connect apps → Add a custom connector**. Name it **Relay Central**, choose **Command**, enter the installed `relay-central` executable as the command and `mcp` as its only argument. Select **Add plugin**. A command connector can also be available to other Bots on the same account.
3. Attach the connector in a new message and ask it to call `staffMe`. Confirm the organization and role. [Grok Bot setup prompt](https://docs.hellocrew.ai/clients/grok-bot/) · [Grok Bot custom connectors](https://docs.x.ai/grok-bot/computer-and-apps) · [Grok Bot secrets](https://docs.x.ai/grok-bot/vault)

### Meta Muse (personal)

Paste this request into personal Muse to create a **Custom Connector** that calls Central’s API directly.

> Create a Relay Central Custom Connector using https://central.hellocrew.ai/openapi/agent.json. Use my organization API token as an HTTP Bearer credential only for requests to https://central.hellocrew.ai. Ask me to enter it through your secure credential form. Call staffMe (GET /api/auth/me) and show my organization and role. Finish setup after that read.

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

For a workspace plugin usable in an eligible local ChatGPT thread, a workspace admin can open **Admin Console → Plugins → Add → Import marketplace**. Enter `https://github.com/Principia-Labs-Org/relay-central-client`, leave the marketplace path empty and select the tag `v1.0.0`. Review the imported plugin and make it available to the intended roles. Each user still needs the client installed and signed in on their computer. [OpenAI marketplace import](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github) · [ChatGPT plugin availability](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)

## Coding agent plugins

### Codex

```sh
codex plugin marketplace add Principia-Labs-Org/relay-central-client
codex plugin add relay-central@relay-platform
codex mcp get relay-central
```

Start a new Codex session. Ask it to use the Relay Central `staffMe` tool to identify your organization and role. For a local checkout, pass its absolute path to `codex plugin marketplace add`. [Codex plugin guide](https://developers.openai.com/plugins/build/plugins)

### Claude Code

```sh
claude plugin marketplace add Principia-Labs-Org/relay-central-client
claude plugin install relay-central@relay-platform
claude mcp list
```

The MCP health check should show `plugin:relay-central:relay-central` as connected. A local checkout also works as the marketplace source. [Claude Code plugin documentation](https://code.claude.com/docs/en/plugins/manifest-reference)

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
