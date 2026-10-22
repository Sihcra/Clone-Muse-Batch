'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { safeName, concatList, progressPct, musicArgs, musicFiles, parseDuration } = require('../src/engine/merge');
const { tmpDir } = require('./helpers');

test('safeName: bỏ ký tự cấm, thêm .mp4, trùng thì -2', () => {
  const dir = tmpDir();
  assert.equal(path.basename(safeName(dir, 'a/b:c?.mp4')), 'a-b-c-.mp4');
  fs.writeFileSync(path.join(dir, 'x.mp4'), '');
  assert.equal(path.basename(safeName(dir, 'x')), 'x-2.mp4');
  assert.match(path.basename(safeName(dir, '')), /^Muse_\d+_ghep\.mp4$/);
});

test('concatList thoát dấu nháy đơn', () => {
  assert.equal(concatList(["C:\\a\\it's.mp4"]), "file 'C:\\a\\it'\\''s.mp4'");
});

test('progressPct đọc out_time_us cuối, tối đa 99', () => {
  assert.equal(progressPct('out_time_us=5000000\nout_time_us=10000000', 20), 50);
  assert.equal(progressPct('out_time_us=99000000', 20), 99);
  assert.equal(progressPct('x', 20), null);
  assert.equal(progressPct('out_time_us=1', 0), null);
  assert.equal(parseDuration('12.5\n'), 12.5);
  assert.equal(parseDuration('N/A'), 0);
});

test('musicArgs: có giọng → nhạc 15% trộn amix; video câm → nhạc 80%', () => {
  const withVoice = musicArgs({ video: 'v.mp4', music: 'm.mp3', out: 'o.mp4', secs: 30, hasAudio: true }).join(' ');
  assert.match(withVoice, /volume=0\.15/);
  assert.match(withVoice, /amix=inputs=2/);
  assert.match(withVoice, /afade=t=out:st=28\.00/);
  const silent = musicArgs({ video: 'v.mp4', music: 'm.mp3', out: 'o.mp4', secs: 10, hasAudio: false }).join(' ');
  assert.match(silent, /volume=0\.8/);
  assert.doesNotMatch(silent, /amix/);
});

test('musicFiles chỉ lấy file nhạc', () => {
  const dir = tmpDir();
  ['a.mp3', 'b.M4A', 'c.txt', '.d.mp3'].forEach(f => fs.writeFileSync(path.join(dir, f), ''));
  assert.deepEqual(musicFiles(dir).map(f => path.basename(f)).sort(), ['a.mp3', 'b.M4A']);
  assert.deepEqual(musicFiles(path.join(dir, 'none')), []);
});
