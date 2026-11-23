import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resourceRecordsProblem } from '@coda-console/protocol/validate';
import { TITLES, TYPES } from '../scripts/metrics.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Runs the command the manifest declares for `kind` as the host does (env as given, CODA_RECORD_KIND set, time limited)
// and returns its stdout parsed as JSON.
async function resourceRecords(kind, env) {
  const { command } = manifest.contributes.records.find(record => record.kind === kind);
  const { stdout } = await run(resolve(root, command), { cwd: root, env: { ...env, CODA_RECORD_KIND: kind }, timeout: 60_000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}

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
  const records = await resourceRecords('coda/resource@1', env);
  // The output is held to the protocol schema, the 64 KiB and the key rules the host holds it to.
  assert.equal(resourceRecordsProblem(records), null);
  const keys = records.map(r => r.key);
  assert.deepEqual(keys, TYPES.filter(type => keys.includes(type)));
  for (const type of ['cpu', 'memory', 'disks', 'disk-io', 'network']) assert.ok(keys.includes(type), type);
  for (const { key, spec } of records) { assert.equal(spec.title, TITLES[key]); assert.ok(spec.resources.length >= 1, key); }
});
