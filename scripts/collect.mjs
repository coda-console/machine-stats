import si from 'systeminformation';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { cpus, totalmem, freemem, networkInterfaces, platform } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { rate } from './metrics.mjs';
const exec = promisify(execFile), mac = platform() === 'darwin', linux = platform() === 'linux';
const run = async (command, args) => (await exec(command, args, { timeout: 2500, maxBuffer: 8 * 1024 * 1024 })).stdout;
const attempt = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };
const read = path => readFile(path, 'utf8');
const numeric = value => value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const id = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
// plutil accepts plist input over stdin; execFile's async form needs the pipe written explicitly.
async function plist(command, args) {
  const xml = await run(command, args);
  const json = await new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { timeout: 2500, maxBuffer: 8 * 1024 * 1024 }, (err, out) => err ? reject(err) : resolve(out));
    child.stdin.on('error', () => {}); child.stdin.end(xml);
  });
  return JSON.parse(json);
}
function cpu() {
  return cpus().reduce((n, c) => ({ idle: n.idle + c.times.idle, total: n.total + Object.values(c.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
}
export function memoryFromMac(text, total, swapText) {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = name => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(text)?.[1]);
  const used = (pages('Anonymous pages') - pages('Pages purgeable') + pages('Pages wired down') + pages('Pages occupied by compressor')) * page;
  const swap = /used\s*=\s*([\d.]+)([MG])/.exec(swapText);
  return { total, available: Number.isFinite(used) ? Math.min(total, Math.max(0, total - used)) : null,
    swap: swap ? Number(swap[1]) * 1024 ** (swap[2] === 'G' ? 3 : 2) : null };
}
async function memory() {
  if (mac) {
    const [vm, swap] = await Promise.all([run('/usr/bin/vm_stat', []), attempt(() => run('/usr/sbin/sysctl', ['-n', 'vm.swapusage']), '')]);
    return memoryFromMac(vm, totalmem(), swap);
  }
  if (linux) {
    const info = await read('/proc/meminfo');
    const kb = key => Number(new RegExp(`${key}:\\s+(\\d+)`).exec(info)?.[1]) * 1024;
    return { total: kb('MemTotal'), available: kb('MemAvailable'), swap: kb('SwapTotal') - kb('SwapFree') };
  }
  return { total: totalmem(), available: freemem(), swap: null };
}
export function storageTree(nodes) {
  const media = {};
  function walk(nodes, stats, physical) {
    for (const n of nodes) {
      const next = n.Statistics ?? stats, drive = n.Whole && n['BSD Name'] ? n['BSD Name'] : physical;
      if (n['BSD Name']) media[n['BSD Name']] = { read: numeric(next?.['Bytes (Read)']), write: numeric(next?.['Bytes (Write)']),
        name: n.IORegistryEntryName, physical: drive };
      walk(n.IORegistryEntryChildren ?? [], next, drive);
    }
  }
  walk(nodes); return media;
}
async function diskCounters() {
  if (mac) return storageTree(await plist('/usr/sbin/ioreg', ['-r', '-c', 'IOBlockStorageDriver', '-a', '-l']));
  if (linux) return Object.fromEntries((await read('/proc/diskstats')).trim().split('\n').map(line => {
    const x = line.trim().split(/\s+/); return [x[2], { read: Number(x[5]) * 512, write: Number(x[9]) * 512 }];
  }));
  return {};
}
export function visibleVolumes(volumes, os = platform(), roles = {}) {
  const seen = new Set();
  return volumes.filter(v => {
    if (!v.fs.startsWith('/dev/') || seen.has(v.fs)) return false;
    if (os === 'darwin' && !(v.mount === '/System/Volumes/Data' || (v.mount.startsWith('/Volumes/') && !(roles[basename(v.fs)] ?? []).length))) return false;
    if (os !== 'darwin' && (/^\/(boot|snap)(\/|$)/.test(v.mount) || v.type === 'squashfs')) return false;
    seen.add(v.fs); return true;
  });
}
async function volumes() {
  const [fs, apfs] = await Promise.all([si.fsSize(), mac ? attempt(() => plist('/usr/sbin/diskutil', ['apfs', 'list', '-plist']), {}) : {}]);
  const apfsVolumes = (apfs.Containers ?? []).flatMap(c => c.Volumes ?? []);
  const roles = Object.fromEntries(apfsVolumes.map(v => [v.DeviceIdentifier, v.Roles]));
  return visibleVolumes(fs, platform(), roles).map(v => {
    const volume = apfsVolumes.find(a => a.DeviceIdentifier === basename(v.fs));
    return { id: id(volume?.APFSVolumeUUID ?? v.mount), device: basename(v.fs), name: volume?.Name ?? (v.mount === '/' ? '系统磁盘' : basename(v.mount)), total: v.size, available: v.available };
  });
}
async function network() {
  const physical = networkInterfaces();
  const rows = await si.networkStats('*');
  return rows.filter(n => n.iface !== 'lo' && n.iface !== 'lo0' && physical[n.iface]?.some(a => !a.internal)).map(n => ({
    id: n.iface, name: n.iface, read: n.rx_bytes, write: n.tx_bytes,
    default: !/^(utun|tun|tap|bridge|docker|veth|awdl|llw|anri)/.test(n.iface),
  }));
}
async function sample() {
  const [net, disks] = await Promise.all([attempt(network), attempt(diskCounters, {})]);
  return { cpu: cpu(), network: net, disks, time: performance.now() };
}
async function gpu() {
  if (mac) {
    // PerformanceStatistics is numeric; reading only it avoids copying the registry's binary device properties.
    const text = await run('/usr/sbin/ioreg', ['-r', '-c', 'IOAccelerator', '-l']);
    return [...text.matchAll(/"PerformanceStatistics"\s*=\s*\{([^\n]+)\}/g)].map((match, index) => {
      const get = name => numeric(new RegExp(`"${name}"=(\\d+)`).exec(match[1])?.[1]);
      return { name: `GPU ${index + 1}`, usage: get('Device Utilization %'), memory: get('In use system memory'), shared: true, temperature: null };
    });
  }
  return (await si.graphics()).controllers.map(g => ({ name: g.model || 'GPU', usage: g.utilizationGpu, memory: g.memoryUsed === undefined ? null : g.memoryUsed * 1024 ** 2, temperature: g.temperatureGpu }));
}
export function batteryPower(text) {
  const raw = /"(?:InstantAmperage|Amperage)"\s*=\s*(-?\d+)/.exec(text)?.[1];
  const volts = numeric(/"Voltage"\s*=\s*(\d+)/.exec(text)?.[1]);
  // Discharging current is sometimes printed as an unsigned 64-bit integer; preserve its low bits before conversion.
  const amps = raw === undefined ? null : Number(BigInt.asIntN(64, BigInt(raw)));
  return amps !== null && Math.abs(amps) < 100000 && volts !== null ? Math.abs(amps * volts) / 1e6 : null;
}
async function battery() {
  const b = await si.battery();
  const result = { present: b.hasBattery, percent: b.percent, charging: b.isCharging, ac: b.acConnected, power: null };
  if (!result.present) return result;
  if (mac) {
    const text = await attempt(() => run('/usr/sbin/ioreg', ['-r', '-c', 'AppleSmartBattery', '-l']), '');
    result.power = batteryPower(text);
  } else if (linux) {
    const name = (await readdir('/sys/class/power_supply')).find(n => n.startsWith('BAT'));
    if (name) {
      const path = `/sys/class/power_supply/${name}`;
      const power = await attempt(async () => numeric((await read(`${path}/power_now`)).trim()));
      if (power !== null) result.power = power / 1e6;
      else {
        const [amps, volts] = await Promise.all(['current_now', 'voltage_now'].map(file => attempt(async () => numeric((await read(`${path}/${file}`)).trim()))));
        if (amps !== null && volts !== null) result.power = Math.abs(amps * volts) / 1e12;
      }
    }
  }
  return result;
}
async function fans() {
  if (!linux) return [];
  const entries = [];
  for (const hw of await readdir('/sys/class/hwmon')) {
    const dir = join('/sys/class/hwmon', hw), name = (await attempt(() => read(join(dir, 'name')), hw)).trim();
    for (const file of await readdir(dir)) if (/^fan\d+_input$/.test(file)) {
      const key = file.replace('_input', '');
      const rpm = await attempt(async () => numeric((await read(join(dir, file))).trim()));
      entries.push({ id: `${name}:${key}`, name: `${name} · ${key}`, rpm });
    }
  }
  return entries;
}
export async function collect() {
  // Inventory and slow optional sensors are read alongside the two-second counter sample, never in a timer loop.
  const details = Promise.all([attempt(memory), attempt(volumes), attempt(() => si.cpuTemperature()), attempt(gpu, []), attempt(battery), attempt(fans, [])]);
  const first = await sample();
  await delay(2000);
  const last = await sample(), seconds = (last.time - first.time) / 1000;
  const [mem, disks, temperature, gpus, batt, fan] = await details;
  const elapsed = last.cpu.total - first.cpu.total;
  return { cpu: elapsed > 0 ? (last.cpu.idle - first.cpu.idle) / elapsed : null, memory: mem,
    disks: disks?.map(d => ({ ...d, read: rate(first.disks[d.device]?.read, last.disks[d.device]?.read, seconds), write: rate(first.disks[d.device]?.write, last.disks[d.device]?.write, seconds) })) ?? null,
    network: last.network?.map(n => { const before = first.network?.find(b => b.id === n.id); return { ...n, down: rate(before?.read, n.read, seconds), up: rate(before?.write, n.write, seconds) }; }) ?? null,
    temperature: temperature?.main, gpus, battery: batt, fans: fan };
}
