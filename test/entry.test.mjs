import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('the entry reads this machine outside Coda and prints one panel with bounded meters and unique metric IDs', async () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CODA_')));
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/stats.mjs', import.meta.url))],
    { cwd: tmpdir(), env, timeout: 30_000 });
  const { items } = JSON.parse(stdout);
  assert.ok(items.some(item => item.title === '处理器'));
  assert.ok(items.some(item => item.title === '内存'));
  const metrics = items.flatMap(item => item.items);
  const ids = metrics.map(item => item.display.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of metrics) {
    assert.ok(['stat', 'meter'].includes(item.type));
    assert.equal(typeof item.value, 'string');
    if (item.type === 'meter') assert.ok(Number.isFinite(item.fraction) && item.fraction >= 0 && item.fraction <= 1);
  }
});
