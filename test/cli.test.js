import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cli = fileURLToPath(new URL('../bin/relay-central.js', import.meta.url));
function command(env, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env, stdio: 'pipe' });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('saved login, failed replacement, logout and account changes across a running MCP session', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'central-cli-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: dir };
  const staff = { get: { operationId: 'staffMe', 'x-required-role': 'viewer' } };
  const doc = { security: [{ bearerAuth: [] }], components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths: { '/api/auth/me': staff } };
  let requests = 0;
  const http = createServer((req, res) => {
    requests++;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/openapi/agent.json') return res.end(JSON.stringify(doc));
    const login = { 'Bearer test-first': 'org-one', 'Bearer test-second': 'org-two' }[req.headers.authorization];
    if (req.url === '/api/auth/me' && login) {
      return res.end(JSON.stringify({ org_id: login, user_id: 'fixture', role: 'viewer' }));
    }
    res.statusCode = 401;
    res.end('{"error":"Invalid token"}');
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  const origin = 'http://127.0.0.1:' + http.address().port;
  const login = token => command(env, ['login', '--origin', origin, '--token-stdin'], token + '\n');
  const first = await login('test-first');
  assert.equal(first.code, 0);
  assert.ok(!first.stdout.includes('test-first'));
  assert.equal((await login('invalid')).code, 1);
  assert.equal(JSON.parse((await command(env, ['whoami'])).stdout).org_id, 'org-one');
  const accidental = await command(env, ['login', 'misplaced-private-value']);
  assert.equal(accidental.code, 1);
  assert.ok(!accidental.stderr.includes('misplaced-private-value'));
  for (const override of [{ CENTRAL_TOKEN: 'env-only' }, { CENTRAL_ORIGIN: origin }]) {
    const incomplete = await command({ ...env, ...override }, ['whoami']);
    assert.equal(incomplete.code, 1);
    assert.match(incomplete.stderr, /both/);
  }
  const before = requests;
  for (const variables of [{ CENTRAL_TOKEN: 'test-second' }, { CENTRAL_TOKEN: 'test-second', CENTRAL_ORIGIN: 'https://other.invalid' }]) {
    const unpaired = await command({ ...env, ...variables }, ['login', '--origin', origin]);
    assert.equal(unpaired.code, 1);
    assert.match(unpaired.stderr, /CENTRAL_ORIGIN/);
    assert.ok(!unpaired.stderr.includes('test-second'));
  }
  assert.equal(requests, before);
  const badFlag = await command(env, ['call', 'staffMe', '--misplaced-private-value']);
  assert.equal(badFlag.code, 1);
  assert.ok(!badFlag.stderr.includes('misplaced-private-value'));
  const paired = await command({ ...env, CENTRAL_ORIGIN: origin, CENTRAL_TOKEN: 'test-first' }, ['login']);
  assert.equal(JSON.parse(paired.stdout).org_id, 'org-one');
  const fromPipe = await command({ ...env, CENTRAL_ORIGIN: 'https://other.invalid', CENTRAL_TOKEN: 'unused' },
    ['login', '--origin', origin, '--token-stdin'], 'test-first\n');
  assert.equal(JSON.parse(fromPipe.stdout).org_id, 'org-one');

  const peer = new Client({ name: 'test', version: '1' });
  await peer.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], env }));
  t.after(() => peer.close());
  assert.deepEqual((await peer.listTools()).tools.map(tool => tool.name), ['staffMe']);
  const call = () => peer.callTool({ name: 'staffMe', arguments: {} });
  assert.equal(JSON.parse((await call()).content[0].text).org_id, 'org-one');
  assert.equal((await command(env, ['logout'])).code, 0);
  assert.equal((await call()).isError, true);
  assert.equal((await login('test-second')).code, 0);
  const switched = await call();
  assert.equal(switched.isError, true);
  assert.match(switched.content[0].text, /Reconnect/);
  const reconnected = await command(env, ['mcp', 'call', 'staffMe']);
  assert.equal(reconnected.code, 0);
  assert.equal(JSON.parse(reconnected.stdout).org_id, 'org-two');
});
