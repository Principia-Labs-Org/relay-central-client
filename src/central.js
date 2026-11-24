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

function reflectsCredential(value, token) {
  // Issued credentials are long. Short fixture tokens may also be ordinary
  // substrings of a record, so match them only as a value or bearer header.
  if (typeof value === 'string') {
    return value === token || value.includes('Bearer ' + token) || (token.length >= 12 && value.includes(token));
  }
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) =>
    (token.length >= 12 && key.includes(token)) || reflectsCredential(child, token));
}

async function requestJson(url, options, token) {
  const deadline = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let response;
  let data;
  try {
    response = await fetch(url, { ...options, signal, redirect: 'error' });
    data = await response.json();
  } catch {
    const checkWrite = options.method && options.method !== 'GET' ? ' Check the saved state before retrying the change.' : '';
    if (options.signal?.aborted) throw new Error('Central request cancelled.' + checkWrite);
    if (deadline.aborted) throw new Error('Central request timed out.' + checkWrite);
    if (!response) throw new Error('Central request failed. Check the origin and connection.' + checkWrite);
    if (response.ok) throw new Error('Central returned an invalid JSON response.' + checkWrite);
  }
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : '';
    // Only display ordinary Central error text. A proxy may return arbitrary content.
    const safe = response.status < 500 && message && message.length <= 512 && !/[\x00-\x1f\x7f-\x9f]/.test(message)
      && !message.includes(token) && !/\b(?:authorization\s*:|bearer\s+|set-cookie\s*:)/i.test(message);
    const failure = new Error(`Central returned HTTP ${response.status}${safe ? ': ' + message : ''}`);
    failure.status = response.status;
    throw failure;
  }
  if (options.headers.Authorization && reflectsCredential(data, token)) {
    const checkWrite = options.method !== 'GET' ? ' Check the saved state before retrying the change.' : '';
    throw new Error('Central returned credential material. The response was withheld.' + checkWrite);
  }
  return data;
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
  const scheme = spec.components?.securitySchemes?.bearerAuth;
  if (scheme?.type !== 'http' || typeof scheme.scheme !== 'string' || scheme.scheme.toLowerCase() !== 'bearer') {
    throw new Error('Central did not advertise organization bearer authentication.');
  }
  const operations = new Map();
  for (const [path, methods] of Object.entries(spec.paths)) {
    if (!isObject(methods) || !path.startsWith('/api/') || /[\\?#]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) {
      throw new Error('Central advertised an invalid operation path.');
    }
    for (const [method, operation] of Object.entries(methods)) {
      if (!supportedMethods.has(method)) continue;
      if (!isObject(operation)) throw new Error('Central advertised an invalid operation.');
      const security = Object.hasOwn(operation, 'security') ? operation.security : spec.security;
      if (!Array.isArray(security) || security.length !== 1 || !isObject(security[0])
          || Object.keys(security[0]).length !== 1 || !Array.isArray(security[0].bearerAuth)
          || security[0].bearerAuth.length !== 0) {
        throw new Error('Central advertised an operation without the required organization bearer authentication.');
      }
      const name = operation.operationId;
      const requiredRole = operation['x-required-role'];
      if (typeof name !== 'string' || !name || operations.has(name) || !roleRank.has(requiredRole)) {
        throw new Error('Central advertised an invalid operation identity or role.');
      }
      const parameters = operation.parameters ?? [];
      if (!Array.isArray(parameters)) throw new Error('Central advertised invalid operation parameters.');
      const templateNames = new Set([...path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]));
      const properties = new Map();
      const required = [];
      for (const param of parameters) {
        if (!['path', 'query'].includes(param?.in) || typeof param.name !== 'string'
            || !param.name || properties.has(param.name) || param.name === 'body'
            || (param.in === 'path' && !templateNames.delete(param.name))) {
          throw new Error('Central advertised an unsupported operation parameter.');
        }
        properties.set(param.name, { ...param.schema, ...(param.description && { description: param.description }) });
        if (param.required || param.in === 'path') required.push(param.name);
      }
      if (templateNames.size) throw new Error('Central advertised an incomplete operation path template.');
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
  if (url.origin !== origin || url.pathname !== path || !url.pathname.startsWith('/api/') || /[{}]/.test(path)) {
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
  if (me?.method !== 'GET' || me.path !== '/api/auth/me' || me.requiredRole !== 'viewer'
      || Object.keys(me.inputSchema.properties).length !== 0) {
    throw new Error('Central did not advertise staffMe as the authenticated GET /api/auth/me identity operation.');
  }
  const identity = await invoke(origin, token, me, {});
  if (!roleRank.has(identity?.role) || typeof identity?.org_id !== 'string' || !identity.org_id.trim()
      || typeof identity.user_id !== 'string' || !identity.user_id.trim()) {
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
