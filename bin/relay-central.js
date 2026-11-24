#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { connect, normalizeOrigin } from '../src/central.js';
import { clearCredentials, loadCredentials, saveCredentials } from '../src/auth.js';

const help = `Usage: relay-central <command>

  login [--origin URL] [--token-stdin]  Verify a token and save a local login
  whoami                               Show authenticated organization and role
  logout                               Remove the saved login
  tools                                List available operation IDs and summaries
  describe <operationId>               Show the operation and JSON argument schema
  call <operationId> [--json JSON|-]    Call Central directly
  mcp                                  Start the MCP server on stdio
  mcp list                             List tools through an MCP client
  mcp call <operationId> [--json JSON|-]  Call a tool through an MCP client
  --version                            Print the client version

Pass --json - to read arguments from stdin. For automation, set CENTRAL_ORIGIN
and CENTRAL_TOKEN together. Run "describe" for path, query and body fields.
`;
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function promptToken() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error('Supply the token with --token-stdin or CENTRAL_TOKEN.');
  }
  // readline still owns terminal editing and restores its mode on close.
  const muted = new Writable({ write(chunk, encoding, done) { done(); } });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
  reader.once('SIGINT', () => reader.close());
  process.stderr.write('Organization API token (hidden): ');
  try {
    for await (const line of reader) return line.trim();
    throw new Error('Login cancelled.');
  } finally {
    reader.close();
    process.stderr.write('\n');
  }
}

async function login(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { origin: { type: 'string' }, 'token-stdin': { type: 'boolean' } } }));
  } catch {
    // Argument parser diagnostics can echo a token supplied in the wrong place.
    throw new Error('Use relay-central login [--origin URL] [--token-stdin].');
  }
  const envOrigin = process.env.CENTRAL_ORIGIN;
  const origin = normalizeOrigin(values.origin ?? envOrigin ?? 'https://central.hellocrew.ai');
  let token;
  if (values['token-stdin']) {
    if (process.stdin.isTTY) throw new Error('Pipe your token to --token-stdin, or omit the flag for a hidden prompt.');
    token = (await stdinText()).trim();
  } else if (process.env.CENTRAL_TOKEN) {
    if (!values.origin && !envOrigin) throw new Error('Pair CENTRAL_TOKEN with CENTRAL_ORIGIN or --origin.');
    if (envOrigin && normalizeOrigin(envOrigin) !== origin) throw new Error('CENTRAL_ORIGIN differs from the requested login origin.');
    token = process.env.CENTRAL_TOKEN;
  } else {
    token = await promptToken();
  }
  const { identity } = await connect({ origin, token });
  await saveCredentials({ origin, token });
  print({ origin, org_id: identity.org_id, org_name: identity.org_name, role: identity.role });
}

async function credentials() {
  const { CENTRAL_TOKEN: token, CENTRAL_ORIGIN: origin } = process.env;
  if (token !== undefined || origin !== undefined) {
    if (!token || !origin) throw new Error('Set both CENTRAL_TOKEN and CENTRAL_ORIGIN, or unset both to use the saved login.');
    return { token, origin: normalizeOrigin(origin) };
  }
  const saved = await loadCredentials();
  if (!saved) throw new Error('Sign in first with relay-central login.');
  return saved;
}

async function callArgs(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: 'string' } } });
  if (positionals.length !== 1) throw new Error('Supply one operation ID. Run relay-central tools to list names.');
  let input;
  try {
    const raw = values.json === '-' ? await stdinText() : values.json;
    input = raw === undefined ? {} : JSON.parse(raw);
  } catch {
    throw new Error('Supply valid JSON with --json, or use --json - for stdin.');
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool arguments must be a JSON object.');
  return { name: positionals[0], input };
}

async function main([command, ...args]) {
  if (!command || ['--help', '-h', 'help'].includes(command)) return process.stdout.write(help);
  if (command === '--version') {
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return process.stdout.write(version + '\n');
  }
  if (command === 'login') return login(args);
  if (command === 'mcp') {
    const { serve, runClient } = await import('../src/mcp.js');
    if (!args.length) return serve(credentials);
    if (args[0] === 'list' && args.length === 1) return print(await runClient());
    if (args[0] === 'call') return print(await runClient(await callArgs(args.slice(1))));
    throw new Error('Use mcp, mcp list, or mcp call <operationId>.');
  }
  if (command === 'logout' && !args.length) {
    await clearCredentials();
    return print({ savedLogin: false });
  }
  if (command === 'call') {
    const { name, input } = await callArgs(args);
    const central = await connect(await credentials());
    return print(await central.call(name, input));
  }
  if ((['whoami', 'tools'].includes(command) && !args.length) || (command === 'describe' && args.length === 1)) {
    const central = await connect(await credentials());
    if (command === 'whoami') return print(central.identity);
    if (command === 'tools') return print(central.operations.map(({ name, method, description, requiredRole }) =>
      ({ name, method, summary: description.split('\n')[0], requiredRole })));
    const operation = central.operations.find(op => op.name === args[0]);
    if (!operation) throw new Error('Operation unavailable for this login. Run relay-central tools.');
    return print(operation);
  }
  throw new Error('Unrecognized command or arguments. Run relay-central --help.');
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write((error.message || 'Central command failed.') + '\n');
  process.exitCode = 1;
});
