# Working on the Relay Central client

For a major delivery, run `npm run test:coverage` and exercise the installed package
against the exact Central candidate. The coverage gate requires strictly more
than 90% for line, branch and function counters. It records the measured client
commit and checks that every `bin` and `src` JavaScript file is present.

This repository owns the Node.js CLI, token login, MCP client and stdio server, and the Codex, Claude Code, Grok Build and Muse Code plugin manifests. Central owns the API, credentials, organization data and permission decisions. Discover operations and roles from the selected origin's `/openapi/agent.json`. Keep the host adapters pointed at the same installed `relay-central mcp` executable.

Keep the origin and credential paired. Verify the token with `staffMe` before saving a login. A host session must reconnect after switching accounts. Use a synthetic organization and disposable credentials for tests. Keep tokens, identities of real users, customer records, private logs and transcripts out of source, examples, releases and model input.

Run `npm ci`, `npm test` and `python3 test/tty-login.py` for changes to the CLI, login or transport. For a release, pack the client and exercise the installed artifact against disposable Central and PostgreSQL, including all 20 operations and the two-organization checks. Qualify host changes through the actual host. The setup commands are in [testing](docs/testing.md) and the [tenant isolation evidence](https://github.com/Principia-Labs-Org/relay-central-client/blob/37a54d41bc6e8a69cf6c24d87ea5a7eb2dc89ad2/test/evidence/README.md). Hosted CI is manually dispatched.

Keep the package and plugin versions aligned and publish the qualified commit with a matching version tag. The HelloCrew website repository owns the [public setup pages](https://docs.hellocrew.ai/clients/). Update the affected guides when installation, token acquisition, host commands or the supported release changes. Preserve the English, Simplified Chinese and Spanish versions and verify the copied prompts against each documented connection method.

The release suite records end-to-end evidence for the CLI, MCP, Codex, Claude Code, Grok Build and Muse Code. Four additional guides cover Grok Bot, personal Meta Muse, Claude Desktop and ChatGPT Desktop. Cite their vendors’ setup documentation and record signed-in results for each app before marking that interface verified. Marketplace listings have their own publication process.
