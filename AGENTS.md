# Working on the Relay Central client

This repository owns the Node.js CLI, token login, MCP client and stdio server, and the Codex, Claude Code, Grok Build and Muse Code plugin manifests. Central owns the API, credentials, organization data and permission decisions. Discover operations and roles from the selected origin's `/openapi/agent.json`. Keep the host adapters pointed at the same installed `relay-central mcp` executable.

Keep the origin and credential paired. Verify the token with `staffMe` before saving a login. A host session must reconnect after switching accounts. Use a synthetic organization and disposable credentials for tests. Keep tokens, identities of real users, customer records, private logs and transcripts out of source, examples, releases and model input.

Run `npm ci`, `npm test` and `python3 test/tty-login.py` for changes to the CLI, login or transport. For a release, pack the client and exercise the installed artifact against disposable Central and PostgreSQL, including all 20 operations and the two-organization checks. Qualify host changes through the actual host. The setup commands are in [testing](docs/testing.md) and the [tenant isolation evidence](test/evidence/README.md). Hosted CI is manually dispatched.

Keep the package and plugin versions aligned and publish the qualified commit with a matching version tag. The HelloCrew website repository owns the public setup pages at [docs.hellocrew.ai/clients/](https://docs.hellocrew.ai/clients/). Update its six guides when installation, token acquisition, host commands or the supported release changes. Preserve the English, Simplified Chinese and Spanish versions and check that copied prompts install and verify the tagged client. Marketplace listings have their own publication process.
