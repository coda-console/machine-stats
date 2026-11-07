// Numeric readings, independent of the OS collectors. Unknown is never a zero or an empty quota bar.
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const clamp = n => Math.min(1, Math.max(0, n));
export function bytes(n, binary = false) {
  if (!valid(n)) return '暂不可读';
  const base = binary ? 1024 : 1000;
  const index = n >= base ** 4 ? 4 : n >= base ** 3 ? 3 : n >= base ** 2 ? 2 : n >= base ? 1 : 0;
  const value = n / base ** index;
  return `${value.toFixed(index && value < 100 ? 1 : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][index]}`;
}
export function rate(before, after, seconds) {
  return valid(before) && valid(after) && after >= before && seconds > 0 ? (after - before) / seconds : null;
}
const number = (n, unit, decimals = 0) => valid(n) ? `${n.toFixed(decimals)} ${unit}` : '暂不可读';
const speed = n => valid(n) ? `${bytes(n)}/s` : '暂不可读';
const name = text => [...String(text)].slice(0, 80).join('');
const UNREADABLE = [{ values: [{ value: '暂不可读' }] }];
// What is left of a capacity, as a bar of it and the free of the total; unknown is unreadable, never an empty bar.
function capacity(free, total, binary = false) {
  if (!valid(free) || !valid(total) || !total) return { value: '暂不可读' };
  free = Math.min(free, total);
  return { value: `${bytes(free, binary)} / ${bytes(total, binary)}`, fraction: clamp(free / total) };
}

// The resource types, in the order the manifest declares them (docs/plugins.md「资源」in Coda): each its own command, which
// reads only what it shows (collect.mjs).
export const TYPES = ['cpu', 'memory', 'swap', 'disks', 'disk-io', 'network', 'temperature', 'gpu', 'battery', 'fans'];

// A type's resources from what was read: this machine's, so none names an identity. What every machine has (CPU, memory,
// disks, network) says it cannot be read; a sensor or a part this machine does not have (swap, temperature, a GPU, a
// battery, fans) shows nothing, which leaves the type off the page here.
export function resources(type, data) {
  switch (type) {
    case 'cpu': return valid(data.cpu) ? [{ values: [{ value: `空闲 ${Math.round(clamp(data.cpu) * 100)}%`, fraction: clamp(data.cpu) }] }] : UNREADABLE;
    case 'memory': return data.memory ? [{ values: [capacity(data.memory.available, data.memory.total, true)] }] : UNREADABLE;
    case 'swap': return valid(data.memory?.swap) ? [{ values: [{ value: `已用 ${bytes(data.memory.swap, true)}` }] }] : [];
    case 'disks': return data.disks ? data.disks.slice(0, 20).map(d => ({ name: name(d.name), values: [capacity(d.available, d.total)] })) : UNREADABLE;
    case 'disk-io': return data.disks ? data.disks.slice(0, 20).map(d => ({ name: name(d.name), values: [{ label: '读取', value: speed(d.read) }, { label: '写入', value: speed(d.write) }] })) : UNREADABLE;
    // The interfaces of a machine's own traffic; tunnels, bridges and the like are left out.
    case 'network': return data.network ? data.network.filter(n => n.default).slice(0, 12).map(n => ({ name: name(n.name), values: [{ label: '下载', value: speed(n.down) }, { label: '上传', value: speed(n.up) }] })) : UNREADABLE;
    case 'temperature': return valid(data.temperature) ? [{ name: 'CPU', values: [{ value: number(data.temperature, '°C') }] }] : [];
    case 'gpu': return (data.gpus ?? []).slice(0, 4).map(g => {
      const values = [valid(g.usage) && { label: '使用率', value: number(g.usage, '%') }, valid(g.memory) && { label: g.shared ? '共享内存已用' : '显存已用', value: bytes(g.memory, true) },
        valid(g.temperature) && { label: '温度', value: number(g.temperature, '°C') }].filter(Boolean);
      return { name: name(g.name), values: values.length ? values : [{ value: '暂不可读' }] };
    });
    case 'battery': {
      const b = data.battery;
      if (!b?.present) return [];
      return [{ values: [valid(b.percent) ? { label: '电量', value: `${Math.round(b.percent)}%`, fraction: clamp(b.percent / 100) } : { label: '电量', value: '暂不可读' },
        { label: '状态', value: b.charging ? '正在充电' : b.ac ? '已接电' : '正在使用电池' },
        ...(valid(b.power) ? [{ label: b.charging ? '充电功率' : b.ac ? '电池功率' : '放电功率', value: number(b.power, 'W', 1) }] : [])] }];
    }
    case 'fans': return (data.fans ?? []).slice(0, 20).map(f => ({ name: name(f.name), values: [{ value: number(f.rpm, 'RPM') }] }));
  }
  return [];
}
