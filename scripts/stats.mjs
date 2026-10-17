// One on-demand reading; Coda filters display IDs using this plugin's display setting.
import { collect } from './collect.mjs';
import { metrics } from './metrics.mjs';
console.log(JSON.stringify({ items: metrics(await collect()) }));
