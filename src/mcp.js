import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import metadata from '../package.json' with { type: 'json' };
import { connect } from './central.js';

const info = { name: 'relay-central', version: metadata.version };

export async function serve(credentials) {
  const server = new Server(info, { capabilities: { tools: {} } });
  let session;
  // A host may start before CLI login. Bind on first use; a later account
  // switch must never send a pending tool call to a different organization.
  async function current() {
    const auth = await credentials();
    if (session && (session.origin !== auth.origin || session.token !== auth.token)) {
      throw new Error('Central login changed. Reconnect the MCP server to use the new login.');
    }
    if (!session) {
      session = { ...auth, client: connect(auth).catch(error => { session = undefined; throw error; }) };
    }
    return session.client;
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { operations } = await current();
    return { tools: operations.map(({ name, description, inputSchema, method }) => ({
      name, description, inputSchema, annotations: { readOnlyHint: method === 'GET' }
    })) };
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
    try {
      const client = await current();
      const value = await client.call(params.name, params.arguments ?? {}, { signal });
      return { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  await server.connect(new StdioServerTransport());
}

// Use the installed executable as a stdio peer, just like an agent host.
export async function runClient(call) {
  const client = new Client(info);
  const env = getDefaultEnvironment();
  for (const key of ['CENTRAL_ORIGIN', 'CENTRAL_TOKEN', 'XDG_CONFIG_HOME', 'NODE_EXTRA_CA_CERTS']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../bin/relay-central.js', import.meta.url)), 'mcp'],
    env
  });
  try {
    await client.connect(transport);
    if (!call) return (await client.listTools()).tools;
    const result = await client.callTool({ name: call.name, arguments: call.input });
    const text = result.content?.find(block => block.type === 'text')?.text;
    if (result.isError) throw new Error(text || 'Central MCP tool failed.');
    return JSON.parse(text);
  } finally {
    await client.close();
  }
}
