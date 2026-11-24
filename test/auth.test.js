import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { clearCredentials, loadCredentials, saveCredentials } from '../src/auth.js';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'central-client-login-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const configDir = join(base, 'config');
  return { base, configDir, file: join(configDir, 'credentials.json'), options: { configDir } };
}
const first = { origin: 'https://first.example', token: 'first-test-token' };
const second = { origin: 'https://second.example', token: 'second-test-token' };

test('stores the login as a private origin/token pair and removes it on logout', async t => {
  const { configDir, file, options } = await fixture(t);
  assert.equal(await loadCredentials(options), null);
  await saveCredentials({ ...first, origin: first.origin + '/' }, options);
  assert.deepEqual(await loadCredentials(options), first);
  if (typeof process.getuid === 'function') {
    assert.equal((await lstat(configDir)).mode & 0o777, 0o700);
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
  }
  await assert.rejects(saveCredentials({ ...second, token: 'bad\nheader' }, options));
  assert.deepEqual(await loadCredentials(options), first);
  await saveCredentials(second, options);
  assert.deepEqual(await loadCredentials(options), second);
  assert.deepEqual(await readdir(configDir), ['credentials.json']);
  await clearCredentials(options);
  await clearCredentials(options);
  assert.equal(await loadCredentials(options), null);
});

test('concurrent logins commit complete credentials together', async t => {
  const { options } = await fixture(t);
  const records = [first, second, first, second];
  await Promise.all(records.map(record => saveCredentials(record, options)));
  const saved = await loadCredentials(options);
  assert.deepEqual(saved, saved.origin === first.origin ? first : second);
});

test('refuses malformed credentials and insecure login paths', { skip: typeof process.getuid !== 'function' }, async t => {
  const { base, configDir, file, options } = await fixture(t);
  await mkdir(configDir, { mode: 0o700 });
  await writeFile(file, '{"token":"private-test-marker"', { mode: 0o600 });
  await assert.rejects(loadCredentials(options), error =>
    error.message.includes('invalid') && !error.message.includes('private-test-marker'));
  await chmod(file, 0o644);
  await assert.rejects(loadCredentials(options), /private|0600/);
  const untouched = join(base, 'other');
  await writeFile(untouched, 'untouched');
  await rm(file);
  await symlink(untouched, file);
  await assert.rejects(loadCredentials(options));
  await saveCredentials(first, options);
  assert.equal(await readFile(untouched, 'utf8'), 'untouched');
  await chmod(configDir, 0o755);
  await assert.rejects(loadCredentials(options), /private/);
  await assert.rejects(saveCredentials(first, options), /private/);
});
