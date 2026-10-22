'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runTask, failurePatch, buildMessage, ensureLogin } = require('../src/engine/muse-runner');
const { tmpDir } = require('./helpers');

function fakePage({ statuses = ['running', 'running', 'idle'], files = [{ path: 'sandbox://out/v.mp4', mime: 'video/mp4', byteLen: 4 }], text = '', sendResult = { ok: true, sessionId: 'sid1' }, threadResult } = {}) {
  const calls = { send: [], cancel: 0 };
  let i = 0;
  return {
    calls,
    async send(msg, atts, thread) {
      calls.send.push({ msg, atts, thread });
      return thread && threadResult ? threadResult : sendResult;
    },
    async status() { return statuses[Math.min(i++, statuses.length - 1)]; },
    async result() { return { files, text }; },
    async readFile() { return Buffer.from('abcd'); },
    async cancel() { calls.cancel++; }
  };
}
const base = (extra = {}) => ({ id: 't', kind: 'video', ratio: '9:16', prompt: 'Cảnh 1', images: [], attempts: 1, startedAt: 0, ...extra });
const opts = (page, outputDir, extra = {}) => ({
  page, outputDir, update: () => {}, isLive: () => true, sleep: async () => {}, now: () => 1000,
  loadImage: async () => ({ mimeType: 'image/png', dataBase64: Buffer.from('img').toString('base64') }), ...extra
});

test('buildMessage ghi loại + tỉ lệ', () => {
  assert.equal(buildMessage({ kind: 'image', ratio: '16:9', prompt: 'x' }), 'Tạo ảnh · tỷ lệ 16:9 ngang\nx');
  assert.equal(buildMessage({ kind: 'video', ratio: '', prompt: 'y' }), 'Tạo video\ny');
});

test('chạy trọn: gửi → dò → tải file mp4 vào thư mục lưu', async () => {
  const dir = tmpDir();
  const page = fakePage();
  const updates = [];
  const files = await runTask(base({ images: [{ imageLocalPath: 'x.png' }] }), opts(page, dir, { update: p => updates.push(p) }));
  assert.equal(files.length, 1);
  assert.ok(files[0].startsWith(dir) && files[0].endsWith('.mp4'));
  assert.equal(fs.readFileSync(files[0], 'utf8'), 'abcd');
  assert.equal(page.calls.send[0].atts[0].filename, 'anh_1.png');
  assert.ok(updates.some(u => u.sessionId === 'sid1'));
});

test('ảnh lưu vào storyboard/, lấy đúng số ảnh expect', async () => {
  const dir = tmpDir();
  const imgs = [1, 2, 3].map(k => ({ path: `p${k}`, mime: 'image/png', byteLen: 4 }));
  const files = await runTask(base({ kind: 'image', expect: 2 }), opts(fakePage({ files: imgs }), dir));
  assert.equal(files.length, 2);
  assert.ok(files.every(f => path.dirname(f) === path.join(dir, 'storyboard')));
});

test('Muse không nhận lệnh → lỗi rõ ràng', async () => {
  await assert.rejects(runTask(base(), opts(fakePage({ sendResult: { ok: false, reason: 'quota' } }), tmpDir())), /Muse không nhận lệnh: quota/);
});

test('Muse không trả file → lỗi museResult kèm câu trả lời của Muse', async () => {
  const err = await runTask(base(), opts(fakePage({ files: [], text: 'Hết lượt' }), tmpDir())).catch(e => e);
  assert.equal(err.museResult, true);
  assert.match(err.message, /Hết lượt/);
});

test('quá giờ → huỷ phiên trên Muse', async () => {
  const page = fakePage({ statuses: ['running'] });
  let t = 0;
  const err = await runTask(base({ startedAt: 0 }), opts(page, tmpDir(), { now: () => (t += 60e3), limits: { image: 1, video: 5 } })).catch(e => e);
  assert.match(err.message, /Quá 5 phút/);
  assert.equal(page.calls.cancel, 1);
});

test('huỷ giữa chừng → trả null, không tải file', async () => {
  assert.equal(await runTask(base(), opts(fakePage(), tmpDir(), { isLive: () => false })), null);
});

test('đã có sessionId → không gửi lại, chỉ dò tiếp', async () => {
  const page = fakePage();
  const files = await runTask(base({ sessionId: 'old' }), opts(page, tmpDir()));
  assert.equal(page.calls.send.length, 0);
  assert.equal(files.length, 1);
});

test('gửi tiếp vào chat storyboard; không vào được thì mở chat mới và ghi lý do', async () => {
  const ok = fakePage({ threadResult: { ok: true, sessionId: 'thr' } });
  await runTask(base({ thread: 'https://muse.ai/thread/thr', pin: 'acc1' }), opts(ok, tmpDir(), { accountId: 'acc1' }));
  assert.equal(ok.calls.send.length, 1);
  assert.equal(ok.calls.send[0].thread, 'thr');

  const bad = fakePage({ threadResult: { ok: false, reason: 'gone' } });
  const updates = [];
  await runTask(base({ thread: 'https://muse.ai/thread/thr', pin: 'acc1' }), opts(bad, tmpDir(), { accountId: 'acc1', update: p => updates.push(p) }));
  assert.equal(bad.calls.send.length, 2);
  assert.ok(updates.some(u => /gone/.test(u.threadError || '')));

  const other = fakePage();
  await runTask(base({ thread: 'https://muse.ai/thread/thr', pin: 'acc1' }), opts(other, tmpDir(), { accountId: 'acc2' }));
  assert.equal(other.calls.send[0].thread, undefined); // chat thuộc TK khác → chat mới luôn
});

test('ảnh gửi kèm quá 8MB bị chặn', async () => {
  const big = Buffer.alloc(9 * 1024 * 1024).toString('base64');
  await assert.rejects(runTask(base({ images: [{}] }), opts(fakePage(), tmpDir(), { loadImage: async () => ({ mimeType: 'image/jpeg', dataBase64: big }) })), /8MB/);
});

test('failurePatch: hết lượt → failed; lỗi mạng sau khi gửi → giữ phiên; còn lại → xếp hàng lại', () => {
  assert.equal(failurePatch({ attempts: 2 }, new Error('x'), 5, 2).status, 'failed');
  const keep = failurePatch({ attempts: 1, sessionId: 's' }, new Error('net'), 5, 2);
  assert.equal(keep.status, undefined);
  assert.equal(keep.attempts, 2);
  const requeue = failurePatch({ attempts: 1, sessionId: 's' }, Object.assign(new Error('m'), { museResult: true }), 5, 2);
  assert.equal(requeue.status, 'queued');
  assert.equal(requeue.sessionId, '');
});

test('ensureLogin: chưa đăng nhập → hiện Chrome, đăng nhập xong thì ẩn', async () => {
  let n = 0;
  const log = [];
  const page = { chrome: { running: true }, login: async () => ({ loggedIn: ++n >= 3 }), show: async () => log.push('show'), hide: async () => log.push('hide') };
  assert.equal(await ensureLogin(page, { sleep: async () => {} }), true);
  assert.deepEqual(log, ['show', 'hide']);
});

test('ensureLogin: người dùng đóng Chrome → dừng, trả false', async () => {
  const page = { chrome: { running: false }, login: async () => ({ loggedIn: false }), show: async () => {}, hide: async () => {} };
  assert.equal(await ensureLogin(page, { sleep: async () => {} }), false);
});
