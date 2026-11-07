// One resource type's reading, on demand (README.md): the type is the first argument, as the manifest's command for it says.
// `--all` reads every type at once and prints each one's, by type, to look at outside Coda (`npm run sample`).
import { collect } from './collect.mjs';
import { TYPES, resources } from './metrics.mjs';

const type = process.argv[2];
if (type === '--all') {
  const data = await collect(TYPES);
  console.log(JSON.stringify(Object.fromEntries(TYPES.map(t => [t, { resources: resources(t, data) }])), null, 2));
} else if (TYPES.includes(type)) console.log(JSON.stringify({ resources: resources(type, await collect([type])) }));
else { console.error(`没有这个资源类型：${type ?? '（没写）'}`); process.exit(2); }
