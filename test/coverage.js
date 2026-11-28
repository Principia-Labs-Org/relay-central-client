import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const destination = resolve('coverage');
mkdirSync(destination, { recursive: true, mode: 0o700 });
const lcov = join(destination, 'client.lcov');
const receipt = join(destination, 'summary.json');
rmSync(lcov, { force: true });
rmSync(receipt, { force: true });

const cases = readdirSync('test').filter(file => file.endsWith('.test.js'));
assert(cases.length, 'No client regression tests found');
const result = spawnSync(process.execPath, [
  '--test', '--experimental-test-coverage', '--test-coverage-include=src/**/*.js',
  '--test-coverage-include=bin/**/*.js', '--test-coverage-lines=90.01',
  '--test-coverage-branches=90.01', '--test-coverage-functions=90.01',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', `--test-reporter-destination=${lcov}`,
  ...cases.map(file => join('test', file)),
], { stdio: 'inherit' });
if (result.error) throw result.error;

const records = readFileSync(lcov, 'utf8').split('\n');
const measured = new Set(records.filter(row => row.startsWith('SF:'))
  .map(row => relative(process.cwd(), resolve(row.slice(3)))));
const expected = ['src', 'bin'].flatMap(dir =>
  readdirSync(dir, { recursive: true }).filter(file => file.endsWith('.js')).map(file => join(dir, file)));
assert(expected.length && expected.every(file => measured.has(file)),
  `Missing client source coverage: ${expected.filter(file => !measured.has(file)).join(', ')}`);

const sum = key => records.filter(row => row.startsWith(key + ':'))
  .reduce((total, row) => total + Number(row.slice(key.length + 1)), 0);
const metrics = Object.fromEntries(Object.entries({
  lines: ['LH', 'LF'], branches: ['BRH', 'BRF'], functions: ['FNH', 'FNF'],
}).map(([label, [hits, count]]) => [label, { covered: sum(hits), total: sum(count) }]));
const passed = result.status === 0 && Object.values(metrics).every(
  ({ covered, total }) => total > 0 && covered * 100 > total * 90,
);
const git = (...args) => {
  const reply = spawnSync('git', args, { encoding: 'utf8' });
  assert.equal(reply.status, 0, reply.stderr);
  return reply.stdout.trim();
};
const summary = {
  source_sha: git('rev-parse', 'HEAD'),
  dirty: Boolean(git('status', '--porcelain')),
  status: passed ? 'passed' : 'failed',
  metrics,
};
writeFileSync(receipt, JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
for (const [label, { covered, total }] of Object.entries(metrics)) {
  console.log(`${label}: ${covered}/${total}`);
}
process.exitCode = passed ? 0 : 1;
