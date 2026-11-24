import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { connect, normalizeOrigin } from '../src/central.js';

const token = 'fixture-token';
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const limitParam = { name: 'limit', in: 'query', schema: { type: 'integer' } };
function document() {
  return {
    servers: [{ url: 'https://different-origin.invalid' }],
    paths: {
      '/api/profile': { get: { operationId: 'staffMe', 'x-required-role': 'viewer' } },
      '/api/records/{id}': {
        get: { operationId: 'lookup', 'x-required-role': 'viewer', parameters: [idParam, limitParam] },
        patch: { operationId: 'save', 'x-required-role': 'admin', parameters: [idParam],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Update' } } } } }
      }
    },
    components: { schemas: {
      Update: { type: 'object', properties: { name: { $ref: '#/components/schemas/Label' } },
        required: ['name'] },
      Label: { type: 'string', maxLength: 80 }
    } }
  };
}

async function server(t, handler) {
  const http = createServer(handler);
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  return 'http://127.0.0.1:' + http.address().port;
}

async function fixture(t, { role = 'admin', spec = document(), responder } = {}) {
  const requests = [];
  const origin = await server(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/openapi/agent.json') return res.end(JSON.stringify(spec));
    if (req.url === '/api/profile') return res.end(JSON.stringify({ user_id: 'user', org_id: 'org', role }));
    if (responder) return responder(req, res);
    res.end(JSON.stringify({ received: true }));
  });
  return { origin, requests };
}

test('derives identity, role and standalone input schemas from the served document', async t => {
  const { origin, requests } = await fixture(t);
  const client = await connect({ origin, token });
  assert.deepEqual(client.identity, { role: 'admin', org_id: 'org', user_id: 'user' });
  assert.deepEqual(requests.map(r => [r.url, r.auth]), [
    ['/openapi/agent.json', undefined], ['/api/profile', 'Bearer ' + token]
  ]);
  const { inputSchema } = client.operations.find(op => op.name === 'save');
  assert.deepEqual(inputSchema.required, ['id', 'body']);
  assert.equal(inputSchema.properties.body.$ref, '#/$defs/Update');
  assert.equal(inputSchema.$defs.Update.properties.name.$ref, '#/$defs/Label');
  assert.equal(inputSchema.$defs.Label.maxLength, 80);

  assert.deepEqual(await client.call('lookup', { id: '+1/a?b', limit: 5 }), { received: true });
  assert.deepEqual(requests.at(-1), { method: 'GET', url: '/api/records/%2B1%2Fa%3Fb?limit=5',
    auth: 'Bearer ' + token, body: undefined });
  const body = { name: 'Nuevo nombre' };
  await client.call('save', { id: 'record', body });
  assert.deepEqual(requests.at(-1), { method: 'PATCH', url: '/api/records/record', auth: 'Bearer ' + token, body });
  const before = requests.length;
  for (const args of [{}, { id: '..' }, { id: 'own', body: {} }, { id: 'own', limit: {} }]) {
    await assert.rejects(client.call('lookup', args));
  }
  await assert.rejects(client.call('save', { id: 'own' }), /body/);
  assert.equal(requests.length, before);
});

test('reads new scalar query options from discovery and preserves false and zero', async t => {
  const spec = document();
  const params = spec.paths['/api/records/{id}'].get.parameters;
  params.push({ name: 'active', in: 'query', schema: { type: 'boolean' } });
  const { origin, requests } = await fixture(t, { spec });
  const client = await connect({ origin, token });
  const lookup = client.operations.find(op => op.name === 'lookup');
  assert.equal(lookup.inputSchema.properties.active.type, 'boolean');
  await client.call('lookup', { id: 'record', active: false, limit: 0 });
  assert.equal(requests.at(-1).url, '/api/records/record?limit=0&active=false');
});

test('pre-dispatch cancellation prevents a write and in-flight cancellation stops waiting', async t => {
  const arrived = Promise.withResolvers();
  const { origin, requests } = await fixture(t, { responder() { arrived.resolve(); } });
  const client = await connect({ origin, token });
  const args = { id: 'record', body: { name: 'test' } };
  await assert.rejects(client.call('save', args, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(requests.length, 2);
  const controller = new AbortController();
  const pending = client.call('save', args, { signal: controller.signal });
  await arrived.promise;
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(requests.filter(r => r.method === 'PATCH').length, 1);
});

test('lists entitled operations and rejects unknown operations, excess roles and invalid identity', async t => {
  const { origin, requests } = await fixture(t, { role: 'viewer' });
  const client = await connect({ origin, token });
  assert.deepEqual(client.operations.map(op => op.name), ['staffMe', 'lookup']);
  await assert.rejects(client.call('save'), /requires the admin role/);
  await assert.rejects(client.call('nonsense'), /Unknown/);
  assert.equal(requests.length, 2);
  const invalid = await fixture(t, { role: 'unrecognized' });
  await assert.rejects(connect({ origin: invalid.origin, token }), /invalid organization identity/);
});

test('discovery and authenticated calls refuse redirects without forwarding credentials', async t => {
  const received = [];
  const destination = await server(t, (req, res) => { received.push(req.url); res.end('{}'); });
  const redirect = (req, res) => { res.writeHead(302, { Location: destination + '/other' }); res.end(); };
  const entry = await server(t, redirect);
  await assert.rejects(connect({ origin: entry, token }), /request failed/);
  const { origin } = await fixture(t, { responder: redirect });
  const client = await connect({ origin, token });
  await assert.rejects(client.call('lookup', { id: 'a' }), /request failed/);
  assert.deepEqual(received, []);

  const spec = document();
  spec.paths['//elsewhere.invalid/api/record'] = spec.paths['/api/records/{id}'];
  const untrusted = await fixture(t, { spec });
  await assert.rejects(connect({ origin: untrusted.origin, token }), /invalid operation path/);
  assert.equal(untrusted.requests.length, 1);
});

test('propagates useful HTTP statuses and messages and suppresses token-bearing errors', async t => {
  for (const message of ['Reload the current revision', 'Bearer ' + token, token, 'Authorization: Basic foo']) {
    const { origin } = await fixture(t, { responder(req, res) {
      res.writeHead(409); res.end(JSON.stringify({ error: message }));
    } });
    const client = await connect({ origin, token });
    await assert.rejects(client.call('lookup', { id: 'record' }), error => {
      assert.equal(error.status, 409);
      assert.equal(error.message.includes(message), message === 'Reload the current revision');
      return true;
    });
  }
});

test('accepts only a clean HTTPS or loopback origin and validates token before requests', async () => {
  assert.equal(normalizeOrigin('https://Central.example:443/'), 'https://central.example');
  assert.equal(normalizeOrigin('http://[::1]:8810'), 'http://[::1]:8810');
  for (const origin of ['http://central.example', 'https://user:password@central.example', 'file:///tmp',
    'https://central.example/non-root', 'https://central.example/?key=secret', 'not-a-url']) {
    assert.throws(() => normalizeOrigin(origin), error => !error.message.includes('secret'));
  }
  await assert.rejects(connect({ origin: 'https://central.example', token: 'line\nbreak' }), /bearer token/);
});
