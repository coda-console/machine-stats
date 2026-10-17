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
const stat = (id, label, value, on = false) => ({ type: 'stat', label, value, display: { id, default: on } });
const number = (n, unit, decimals = 0) => valid(n) ? `${n.toFixed(decimals)} ${unit}` : '暂不可读';
const speed = n => valid(n) ? `${bytes(n)}/s` : '暂不可读';
function capacity(id, label, free, total, on = true, binary = false) {
  if (!valid(free) || !valid(total) || !total) return stat(id, label, '暂不可读', on);
  free = Math.min(free, total);
  return { type: 'meter', label, value: `${bytes(free, binary)} / ${bytes(total, binary)}`, fraction: clamp(free / total),
    note: `已用 ${bytes(total - free, binary)}`, display: { id, default: on } };
}
const card = (title, items, subtitle) => ({ type: 'card', title: [...title].slice(0, 80).join(''), ...(subtitle ? { subtitle } : {}), items });
export function metrics(data) {
  const items = [];
  const idle = data.cpu;
  items.push(card('处理器', [valid(idle) ? { type: 'meter', label: 'CPU 空闲', value: `${Math.round(clamp(idle) * 100)}%`,
    fraction: clamp(idle), note: `已用 ${Math.round((1 - clamp(idle)) * 100)}%`, display: { id: 'cpu', default: true } } : stat('cpu', 'CPU 空闲', '暂不可读', true)]));
  const mem = data.memory ?? {};
  items.push(card('内存', [capacity('memory', '内存可用', mem.available, mem.total, true, true), stat('swap', '交换空间已用', bytes(mem.swap, true))]));
  for (const d of (data.disks ?? []).slice(0, 20)) {
    items.push(card(d.name, [capacity(`disk:${d.id}:capacity`, '可用空间', d.available, d.total),
      stat(`disk:${d.id}:read`, '读取速度', speed(d.read)), stat(`disk:${d.id}:write`, '写入速度', speed(d.write))], '读写为所在磁盘的采样平均'));
  }
  if (data.disks === null) items.push(card('磁盘', [stat('disks-unavailable', '可用空间', '暂不可读', true)]));
  for (const n of (data.network ?? []).slice(0, 12)) items.push(card(`网络 · ${n.name}`, [
    stat(`network:${n.id}:down`, '下载速度', speed(n.down), n.default), stat(`network:${n.id}:up`, '上传速度', speed(n.up), n.default)], '采样 2 秒平均'));
  if (data.network === null) items.push(card('网络', [stat('network-unavailable', '网络速度', '暂不可读', true)]));
  items.push(card('温度', [stat('cpu-temperature', 'CPU 温度', number(data.temperature, '°C'), true)]));
  for (const [index, g] of (data.gpus ?? []).slice(0, 4).entries()) items.push(card(`GPU · ${g.name}`, [
    stat(`gpu:${index}:usage`, '使用率', number(g.usage, '%')),
    stat(`gpu:${index}:memory`, g.shared ? '共享内存已用' : '显存已用', bytes(g.memory, true)),
    stat(`gpu:${index}:temperature`, 'GPU 温度', number(g.temperature, '°C'))]));
  if (data.battery?.present) {
    const b = data.battery;
    items.push(card('电池', [valid(b.percent) ? { type: 'meter', label: '剩余电量', value: `${Math.round(b.percent)}%`, fraction: clamp(b.percent / 100),
      note: b.charging ? '正在充电' : b.ac ? '已接电' : '正在使用电池', display: { id: 'battery', default: false } } : stat('battery', '剩余电量', '暂不可读'),
      stat('battery-power', b.charging ? '充电功率' : b.ac ? '电池功率' : '放电功率', number(b.power, 'W', 1))]));
  }
  const fans = data.fans ?? [];
  items.push(card('风扇', fans.length ? fans.slice(0, 8).map(f => stat(`fan:${f.id}`, f.name, number(f.rpm, 'RPM'))) : [stat('fan', '转速', '暂不可读')]));
  return items;
}
