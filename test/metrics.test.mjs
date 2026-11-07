import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, resources, rate, bytes } from '../scripts/metrics.mjs';
import { memoryFromMac, visibleVolumes, storageTree, batteryPower } from '../scripts/collect.mjs';
const GB = 1e9;
const sample = { cpu: .76, memory: { available: 12.8 * GB, total: 32 * GB, swap: GB }, temperature: null,
  disks: [{ id: 'one', name: 'Macintosh HD', total: 1e12, available: 386 * GB, read: 0, write: 2500 },
    { id: 'two', name: '外置盘', total: 2e12, available: 1.28e12, read: null, write: null }],
  network: [{ id: 'en0', name: 'en0', down: 8.42e6, up: 1.26e6, default: true }],
  gpus: [{ name: 'GPU', usage: 0, memory: 0 }], battery: { present: true, percent: 82, power: 24.8, charging: true }, fans: [{ id: 'left', name: '左侧', rpm: 0 }] };
const read = type => resources(type, sample);

test('numeric samples divide counter deltas by actual elapsed seconds and never invent zero', () => {
  assert.equal(rate(100, 900, 2), 400);
  assert.equal(rate(100, 900, 4), 200);
  assert.equal(rate(100, 100, 2), 0);
  for (const args of [[null, 100, 2], [100, undefined, 2], [100, 50, 2], [100, 900, 0]]) assert.equal(rate(...args), null);
  assert.equal(bytes(null), '暂不可读');
  assert.equal(bytes(386 * GB), '386 GB');
  assert.equal(bytes(1.28e12), '1.3 TB');
});

test('each type is its resources: capacity bars express what remains; what every machine has but cannot read says so; a part it lacks shows nothing', () => {
  assert.deepEqual(read('cpu'), [{ values: [{ value: '空闲 76%', fraction: .76 }] }]);
  assert.deepEqual(read('memory'), [{ values: [{ value: '11.9 GB / 29.8 GB', fraction: .4 }] }]);
  assert.deepEqual(read('swap'), [{ values: [{ value: '已用 954 MB' }] }]);
  assert.deepEqual(read('disks'), [{ name: 'Macintosh HD', values: [{ value: '386 GB / 1.0 TB', fraction: .386 }] },
    { name: '外置盘', values: [{ value: '1.3 TB / 2.0 TB', fraction: .64 }] }]);
  assert.deepEqual(read('disk-io')[1].values, [{ label: '读取', value: '暂不可读' }, { label: '写入', value: '暂不可读' }]);
  assert.deepEqual(read('network'), [{ name: 'en0', values: [{ label: '下载', value: '8.4 MB/s' }, { label: '上传', value: '1.3 MB/s' }] }]);
  assert.deepEqual(read('gpu'), [{ name: 'GPU', values: [{ label: '使用率', value: '0 %' }, { label: '显存已用', value: '0 B' }] }]);
  assert.deepEqual(read('battery'), [{ values: [{ label: '电量', value: '82%', fraction: .82 }, { label: '状态', value: '正在充电' }, { label: '充电功率', value: '24.8 W' }] }]);
  assert.deepEqual(read('fans'), [{ name: '左侧', values: [{ value: '0 RPM' }] }]);
  // No sensor, no battery, no GPU here: those types show nothing; CPU, memory, disks and network never read say so.
  assert.deepEqual(read('temperature'), []);
  assert.deepEqual(resources('battery', { battery: { present: false } }), []);
  assert.deepEqual(resources('gpu', {}), []);
  for (const type of ['cpu', 'memory', 'disks', 'network']) assert.deepEqual(resources(type, { cpu: null, memory: null, disks: null, network: null }), [{ values: [{ value: '暂不可读' }] }], type);
  assert.deepEqual(resources('memory', { memory: { available: null, total: GB } }), [{ values: [{ value: '暂不可读' }] }]);
  // Tunnels and bridges are not a machine's own traffic.
  assert.deepEqual(resources('network', { network: [{ id: 'utun3', name: 'utun3', down: 1, up: 1, default: false }] }), []);
  assert.deepEqual(TYPES.filter(type => !resources(type, sample).length), ['temperature']);
});

test('macOS memory follows used memory and swap units, not just free pages', () => {
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nAnonymous pages: 1000.\nPages purgeable: 100.\nPages wired down: 200.\nPages occupied by compressor: 50.';
  const memory = memoryFromMac(vm, GB, 'total = 2048.00M used = 512.00M free = 1536.00M');
  assert.equal(memory.available, GB - 1150 * 16384);
  assert.equal(memory.swap, 512 * 1024 ** 2);
  assert.equal(memoryFromMac('', GB, '').available, null);
});

test('volume discovery omits system and simulator mounts while retaining data and external volumes', () => {
  const volume = (fs, mount) => ({ fs, mount });
  const inputs = [volume('/dev/disk3s1', '/System/Volumes/Data'), volume('/dev/disk3s3', '/'),
    volume('/dev/disk3s5', '/Volumes/Recovery'), volume('/dev/disk7s1', '/Volumes/My SSD'),
    volume('/dev/disk8s1', '/Library/Developer/CoreSimulator/Volumes/iOS'), volume('tmpfs', '/tmp')];
  assert.deepEqual(visibleVolumes(inputs, 'darwin', { disk3s5: ['Recovery'] }).map(i => i.mount), ['/System/Volumes/Data', '/Volumes/My SSD']);
  assert.deepEqual(visibleVolumes([volume('/dev/nvme0n1p2', '/'), volume('/dev/sdb1', '/media/SSD'), volume('/dev/loop0', '/snap/core')], 'linux').map(i => i.mount), ['/', '/media/SSD']);
});

test('APFS child volumes use the counters of their containing physical disk', () => {
  const media = storageTree([{ Statistics: { 'Bytes (Read)': 123, 'Bytes (Write)': 456 }, IORegistryEntryChildren: [
    { 'BSD Name': 'disk0', Whole: true, IORegistryEntryChildren: [{ 'BSD Name': 'disk3s1', IORegistryEntryName: 'Data' }] },
  ] }]);
  assert.deepEqual(media.disk3s1, { read: 123, write: 456, name: 'Data', physical: 'disk0' });
});

test('battery discharge power preserves signed current and does not mistake absent sensors for zero', () => {
  assert.equal(batteryPower('"InstantAmperage" = 1000\n"Voltage" = 12000'), 12);
  assert.equal(batteryPower('"Amperage" = 18446744073709550616\n"Voltage" = 12000'), 12);
  assert.equal(batteryPower('"Amperage" = 0\n"Voltage" = 12000'), 0);
  assert.equal(batteryPower('"Voltage" = 12000'), null);
});
