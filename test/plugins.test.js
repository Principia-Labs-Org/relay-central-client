import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repository = new URL('../', import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, repository), 'utf8'));
}

test('both marketplaces resolve the same installable plugin and local executable', async () => {
  const [codex, claude, pkg] = await Promise.all([
    json('.agents/plugins/marketplace.json'), json('.claude-plugin/marketplace.json'), json('package.json')
  ]);
  const [codexPlugin] = codex.plugins;
  const [claudePlugin] = claude.plugins;
  assert.equal(codex.name, claude.name);
  assert.equal(codexPlugin.name, claudePlugin.name);
  assert.deepEqual(codexPlugin.source, { source: 'local', path: claudePlugin.source });
  const plugin = await json(claudePlugin.source + '/.claude-plugin/plugin.json');
  assert.equal(plugin.name, codexPlugin.name);
  assert.equal(plugin.version, pkg.version);
  const { mcpServers } = await json(claudePlugin.source + '/.mcp.json');
  assert.deepEqual(mcpServers, {
    'relay-central': { type: 'stdio', command: 'relay-central', args: ['mcp'] }
  });
  assert.ok(pkg.bin[mcpServers['relay-central'].command]);
});
