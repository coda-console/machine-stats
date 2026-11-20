import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { TITLES, TYPES } from '../scripts/metrics.mjs';

// plugin-check 0.8.27 does not list check/resources.mjs in its `exports`, so it is imported by its file.
const { resourceRecords } = await import(new URL('../node_modules/@coda-console/plugin-check/check/resources.mjs', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the manifest has Coda write the resource records by one command, and declares no resources of its own', () => {
  assert.equal(manifest.engines.coda, 6);
  assert.equal(manifest.contributes.resources, undefined);
  assert.deepEqual(manifest.contributes.protocolImplementations, ['coda/resource@1']);
  assert.deepEqual(manifest.contributes.records, [{ kind: 'coda/resource@1', command: 'scripts/resource.mjs' }]);
  assert.ok(statSync(new URL('../scripts/resource.mjs', import.meta.url)).mode & 0o111, 'the record command is executable');
  assert.match(readFileSync(new URL('../scripts/resource.mjs', import.meta.url), 'utf8'), /^#!\/usr\/bin\/env node\n/);
});

test('the record command, as the host runs it, prints coda/resource@1 records of this machine: what every machine has, each type once, in order', async () => {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CODA_'))), CODA_PLUGIN_PATH: root,
    PATH: `${dirname(process.execPath)}:${process.env.PATH}` };
  // resourceRecords holds the output to the protocol schema, the 64 KiB and the key rules the host holds it to.
  const records = await resourceRecords(root, { env });
  const keys = records.map(r => r.key);
  assert.deepEqual(keys, TYPES.filter(type => keys.includes(type)));
  for (const type of ['cpu', 'memory', 'disks', 'disk-io', 'network']) assert.ok(keys.includes(type), type);
  for (const { key, spec } of records) { assert.equal(spec.title, TITLES[key]); assert.ok(spec.resources.length >= 1, key); }
});
