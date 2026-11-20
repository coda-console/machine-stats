#!/usr/bin/env node
// The `coda/resource@1` record command (contributes.records, README.md): one record for each resource type this machine has,
// all read at once. Coda runs it when the resources page opens or is refreshed, and when a plugin starts or changes; the
// plugin runs nothing of its own in between (`npm run sample` runs it by hand).
import { collect } from './collect.mjs';
import { TYPES, records } from './metrics.mjs';

console.log(JSON.stringify(records(await collect(TYPES))));
