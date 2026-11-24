const roleRank = new Map([['viewer', 0], ['operator', 1], ['admin', 2]]);
const supportedMethods = new Set(['get', 'post', 'patch', 'put', 'delete']);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeOrigin(value) {
  let url;
  try {
    if (typeof value !== 'string') throw new Error();
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid Central origin.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a Central HTTPS origin, or HTTP on localhost for testing.');
  }
  return url.origin;
}

export function validateToken(token) {
  if (typeof token !== 'string' || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('Enter a nonempty bearer token without spaces or control characters.');
  }
}

async function requestJson(url, options, token) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error' });
  } catch {
    if (options.signal?.aborted) throw new Error('Central request cancelled.');
    throw new Error('Central request failed. Check the origin and connection.');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const message = typeof error?.error === 'string' ? error.error : '';
    // Only display ordinary Central error text. A proxy may return arbitrary content.
    const safe = response.status < 500 && message && message.length <= 512 && !/[\x00-\x1f\x7f-\x9f]/.test(message)
      && !message.includes(token) && !/\b(?:authorization\s*:|bearer\s+|set-cookie\s*:)/i.test(message);
    const failure = new Error(`Central returned HTTP ${response.status}${safe ? ': ' + message : ''}`);
    failure.status = response.status;
    throw failure;
  }
  try {
    return await response.json();
  } catch {
    if (options.signal?.aborted) throw new Error('Central request cancelled.');
    throw new Error('Central returned an invalid JSON response.');
  }
}

// MCP tools get a self-contained schema. Keep shared and recursive references
// in local $defs instead of expanding each use into another copy.
function toolSchema(input, components) {
  const definitions = new Map();
  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key !== '$ref') return [key, copy(child)];
      const prefix = '#/components/schemas/';
      if (typeof child !== 'string' || !child.startsWith(prefix)) {
        throw new Error('Central advertised an unsupported schema reference.');
      }
      const pointer = child.slice(prefix.length);
      const name = pointer.replaceAll('~1', '/').replaceAll('~0', '~');
      if (pointer.includes('/') || !components || !Object.hasOwn(components, name)) {
        throw new Error('Central advertised a missing schema definition.');
      }
      if (!definitions.has(name)) {
        definitions.set(name, null);
        definitions.set(name, copy(components[name]));
      }
      return [key, '#/$defs/' + pointer];
    }));
  }
  const result = copy(input);
  if (definitions.size) result.$defs = Object.fromEntries(definitions);
  return result;
}

function readOperations(spec) {
  if (!isObject(spec?.paths)) throw new Error('Central returned an invalid agent document.');
  const operations = new Map();
  for (const [path, methods] of Object.entries(spec.paths)) {
    if (!path.startsWith('/api/') || /[\\?#]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) {
      throw new Error('Central advertised an invalid operation path.');
    }
    for (const [method, operation] of Object.entries(methods)) {
      if (!supportedMethods.has(method)) continue;
      const name = operation.operationId;
      const requiredRole = operation['x-required-role'];
      if (typeof name !== 'string' || !name || operations.has(name) || !roleRank.has(requiredRole)) {
        throw new Error('Central advertised an invalid operation identity or role.');
      }
      const parameters = operation.parameters ?? [];
      const properties = new Map();
      const required = [];
      for (const param of parameters) {
        if (!['path', 'query'].includes(param.in) || typeof param.name !== 'string'
            || properties.has(param.name) || param.name === 'body') {
          throw new Error('Central advertised an unsupported operation parameter.');
        }
        properties.set(param.name, { ...param.schema, ...(param.description && { description: param.description }) });
        if (param.required || param.in === 'path') required.push(param.name);
      }
      if (operation.requestBody) {
        const body = operation.requestBody.content?.['application/json']?.schema;
        if (!body) throw new Error('Central advertised an unsupported request body.');
        properties.set('body', body);
        if (operation.requestBody.required) required.push('body');
      }
      const inputSchema = toolSchema({ type: 'object', properties: Object.fromEntries(properties),
        required, additionalProperties: false }, spec.components?.schemas);
      operations.set(name, { name, method: method.toUpperCase(), path, requiredRole, inputSchema,
        description: [operation.summary, operation.description].filter(Boolean).join('\n\n'), parameters });
    }
  }
  return operations;
}

function invoke(origin, token, operation, args, signal) {
  const { method, parameters, inputSchema } = operation;
  if (!isObject(args) || Object.keys(args).some(key => !Object.hasOwn(inputSchema.properties, key))) {
    throw new Error('Supply only the fields declared by this operation.');
  }
  for (const key of inputSchema.required) {
    if (!Object.hasOwn(args, key) || args[key] == null) throw new Error(`Missing required argument: ${key}`);
  }
  let path = operation.path;
  const query = new URLSearchParams();
  for (const { name, in: location } of parameters) {
    if (!Object.hasOwn(args, name)) continue;
    const value = args[name];
    if (!['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`Expected a scalar argument for ${name}.`);
    }
    if (location === 'path') {
      if (value === '.' || value === '..' || value === '') throw new Error('Invalid path argument.');
      path = path.replaceAll('{' + name + '}', encodeURIComponent(String(value)));
    } else {
      query.set(name, String(value));
    }
  }
  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/api/') || /[{}]/.test(path)) {
    throw new Error('Invalid Central operation destination.');
  }
  url.search = query.toString();
  const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
  const options = { method, headers, signal };
  if (Object.hasOwn(args, 'body')) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(args.body);
  }
  return requestJson(url, options, token);
}

export async function connect({ origin, token }) {
  origin = normalizeOrigin(origin);
  validateToken(token);
  const spec = await requestJson(origin + '/openapi/agent.json', { headers: { Accept: 'application/json' } }, token);
  const catalog = readOperations(spec);
  const me = catalog.get('staffMe');
  if (me?.method !== 'GET') throw new Error('Central did not advertise the staffMe identity operation.');
  const identity = await invoke(origin, token, me, {});
  if (!roleRank.has(identity?.role) || typeof identity?.org_id !== 'string' || !identity.org_id
      || typeof identity.user_id !== 'string' || !identity.user_id) {
    throw new Error('Central returned an invalid organization identity.');
  }
  const allowed = new Map([...catalog].filter(([, op]) => roleRank.get(op.requiredRole) <= roleRank.get(identity.role)));
  return {
    origin, identity,
    operations: [...allowed.values()].map(({ parameters, ...op }) => op),
    async call(name, args = {}, { signal } = {}) {
      signal?.throwIfAborted();
      if (!catalog.has(name)) throw new Error('Unknown Central operation.');
      if (!allowed.has(name)) throw new Error(`This operation requires the ${catalog.get(name).requiredRole} role.`);
      return invoke(origin, token, allowed.get(name), args, signal);
    }
  };
}
