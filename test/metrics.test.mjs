import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, rate, bytes } from '../scripts/metrics.mjs';
import { memoryFromMac, visibleVolumes, storageTree, batteryPower } from '../scripts/collect.mjs';
const GB = 1e9;
const sample = { cpu: .76, memory: { available: 12.8 * GB, total: 32 * GB, swap: GB }, temperature: null,
  disks: [{ id: 'one', name: 'Macintosh HD', total: 1e12, available: 386 * GB, read: 0, write: 2500 },
    { id: 'two', name: '外置盘', total: 2e12, available: 1.28e12, read: null, write: null }],
  network: [{ id: 'en0', name: 'en0', down: 8.42e6, up: 1.26e6, default: true }],
  gpus: [{ name: 'GPU', usage: 0, memory: 0 }], battery: { present: true, percent: 82, power: 24.8, charging: true }, fans: [{ id: 'left', name: '左侧', rpm: 0 }] };
const read = metrics;

test('numeric samples divide counter deltas by actual elapsed seconds and never invent zero', () => {
  assert.equal(rate(100, 900, 2), 400);
  assert.equal(rate(100, 900, 4), 200);
  assert.equal(rate(100, 100, 2), 0);
  for (const args of [[null, 100, 2], [100, undefined, 2], [100, 50, 2], [100, 900, 0]]) assert.equal(rate(...args), null);
  assert.equal(bytes(null), '暂不可读');
  assert.equal(bytes(386 * GB), '386 GB');
  assert.equal(bytes(1.28e12), '1.3 TB');
});

test('missing hardware has an unavailable value; capacity bars always express remaining capacity', () => {
  const items = read(sample), all = items.flatMap(i => i.items);
  const temp = all.find(i => i.display.id === 'cpu-temperature');
  assert.deepEqual([temp.type, temp.value, temp.fraction], ['stat', '暂不可读', undefined]);
  assert.equal(all.find(i => i.display.id === 'disk:one:capacity').fraction, .386);
  assert.equal(all.find(i => i.display.id === 'disk:two:read').value, '暂不可读');
  assert.equal(all.find(i => i.display.id === 'fan:left').value, '0 RPM');
  assert.ok(!read({ ...sample, battery: { present: false } }).some(i => i.title === '电池'));
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
