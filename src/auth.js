import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { normalizeOrigin, validateToken } from './central.js';

function directory({ configDir } = {}) {
  const dir = configDir ?? join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'relay-central-client');
  if (!isAbsolute(dir)) throw new Error('Use an absolute path for the private Central login directory.');
  return dir;
}

function privateMode(stat) {
  return typeof process.getuid !== 'function' || (stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
}

async function checkDirectory(dir) {
  const stat = await lstat(dir);
  if (!stat.isDirectory() || !privateMode(stat)) {
    throw new Error('The Central login directory must be private to your user (0700).');
  }
}

function credentials(value) {
  const origin = normalizeOrigin(value?.origin);
  validateToken(value?.token);
  return { origin, token: value.token };
}

export async function loadCredentials(options) {
  const dir = directory(options);
  let file;
  try {
    await checkDirectory(dir);
    const path = join(dir, 'credentials.json');
    if (!constants.O_NOFOLLOW && !(await lstat(path)).isFile()) {
      throw new Error('The Central login must be a regular file.');
    }
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || !privateMode(stat)) throw new Error('The Central login file must be private to your user (0600).');
    let value;
    try {
      value = JSON.parse(await file.readFile('utf8'));
    } catch {
      throw new Error('The Central login file is invalid. Sign in again.');
    }
    return credentials(value);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await file?.close();
  }
}

export async function saveCredentials(value, options) {
  const data = credentials(value);
  const dir = directory(options);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await checkDirectory(dir);
  const temp = join(dir, '.login-' + randomUUID());
  const file = await open(temp, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(data) + '\n');
    } finally {
      await file.close();
    }
    await rename(temp, join(dir, 'credentials.json'));
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function clearCredentials(options) {
  const dir = directory(options);
  try {
    await checkDirectory(dir);
    await unlink(join(dir, 'credentials.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
