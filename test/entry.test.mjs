import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const entry = fileURLToPath(new URL('../scripts/stats.mjs', import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CODA_')));
const run = args => promisify(execFile)(process.execPath, [entry, ...args], { cwd: tmpdir(), env, timeout: 30_000 });
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('each type the manifest declares reads this machine outside Coda as resources of names and bounded values', async () => {
  const declared = manifest.contributes.resources;
  assert.deepEqual(declared.filter(t => !t.hidden).map(t => t.title), ['CPU', '内存', '磁盘', '网络', '温度']);
  const all = JSON.parse((await run(['--all'])).stdout);
  assert.deepEqual(Object.keys(all), declared.map(t => t.id));
  assert.equal(all.cpu.resources.length, 1); assert.equal(all.memory.resources.length, 1);
  for (const [type, { resources }] of Object.entries(all)) for (const resource of resources) {
    assert.ok(Object.keys(resource).every(key => ['name', 'values'].includes(key)), type);
    assert.ok(resource.values.length >= 1 && resource.values.length <= 8, type);
    for (const value of resource.values) {
      assert.equal(typeof value.value, 'string', type);
      if ('fraction' in value) assert.ok(Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1, type);
    }
  }
  // One type, as its command runs it: only what it shows.
  const { stdout } = await run(['memory']);
  assert.deepEqual(Object.keys(JSON.parse(stdout)), ['resources']);
  await assert.rejects(run(['load']), /没有这个资源类型：load/);
});
