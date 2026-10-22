'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('../src/engine/pool');
const { memTasks, memAccounts } = require('./helpers');

const settle = () => new Promise(r => setTimeout(r, 20));
const pageOk = { login: async () => ({ loggedIn: true }), quota: async () => ({ pct: 10 }), cancel: async () => {}, chrome: { running: true } };

function makePool({ tasks, accounts, run, page = pageOk, extra = {} }) {
  return new Pool({
    tasks, accounts, pageFor: () => page, loadImage: async () => ({}),
    config: () => ({ outputDir: '/tmp', maxAttempts: 2, limits: { image: 5, video: 30 } }),
    run, sleep: async () => {}, gap: () => 0, now: () => 1000, ...extra
  });
}

test('chạy task trên tài khoản rảnh, xong thì succeeded + files + gọi onFiles', async () => {
  const tasks = memTasks([{ id: 't1', kind: 'video' }]);
  const accounts = memAccounts([{ id: 'a' }]);
  const got = [];
  const pool = makePool({ tasks, accounts, run: async () => ['/tmp/v.mp4'], extra: { onFiles: f => got.push(...f) } });
  pool.pump();
  await settle();
  const t = tasks.get('t1');
  assert.equal(t.status, 'succeeded');
  assert.deepEqual(t.files, ['/tmp/v.mp4']);
  assert.equal(t.attempts, 1);
  assert.deepEqual(got, ['/tmp/v.mp4']);
  assert.equal(pool.running.size, 0);
});

test('ảnh xong → ghi link chat để video làm tiếp trong chat đó', async () => {
  const tasks = memTasks([{ id: 't1', kind: 'image' }]);
  const pool = makePool({
    tasks, accounts: memAccounts([{ id: 'a' }]),
    run: async (task, { update }) => { update({ sessionId: 'abc' }); return ['/tmp/a.png']; }
  });
  pool.pump();
  await settle();
  assert.equal(tasks.get('t1').thread, 'https://muse.ai/thread/abc');
});

test('chưa đăng nhập → trả task về hàng đợi, không tính lượt', async () => {
  const tasks = memTasks([{ id: 't1' }]);
  const accounts = memAccounts([{ id: 'a' }]);
  const page = { ...pageOk, login: async () => ({ loggedIn: false }) };
  let ran = false;
  const pool = makePool({ tasks, accounts, page, run: async () => { ran = true; return []; } });
  await pool.runOne(tasks.get('t1'), 'a');
  const t = tasks.get('t1');
  assert.equal(ran, false);
  assert.equal(t.status, 'queued');
  assert.equal(t.attempts, 0);
  assert.match(t.error, /chưa đăng nhập/);
  assert.equal(accounts.get('a').loggedIn, false);
});

test('lỗi lần đầu → xếp hàng lại; lần 2 → failed', async () => {
  const tasks = memTasks([{ id: 't1' }]);
  const accounts = memAccounts([{ id: 'a' }]);
  const pool = makePool({ tasks, accounts, run: async () => { throw Object.assign(new Error('boom'), { museResult: true }); } });
  await pool.runOne(tasks.get('t1'), 'a');
  assert.equal(tasks.get('t1').status, 'queued');
  await pool.runOne(tasks.get('t1'), 'a');
  assert.equal(tasks.get('t1').status, 'failed');
  assert.equal(tasks.get('t1').error, 'boom');
});

test('Muse không nhận lệnh vì hết hạn mức → task về hàng đợi chờ TK khác, không tính lượt', async () => {
  const tasks = memTasks([{ id: 't1' }]);
  const accounts = memAccounts([{ id: 'a' }], { useTopup: false });
  const page = { ...pageOk, quota: async () => ({ pct: 100, resetsAt: 99999, topupLeft: 0 }) };
  const pool = makePool({ tasks, accounts, page, run: async () => { throw new Error('Muse không nhận lệnh: limit'); } });
  await pool.runOne(tasks.get('t1'), 'a');
  const t = tasks.get('t1');
  assert.equal(t.status, 'queued');
  assert.equal(t.attempts, 0);
  assert.match(t.error, /hết hạn mức/);
});

test('nghỉ giữa 2 lần gửi trên cùng tài khoản', async () => {
  const tasks = memTasks([{ id: 't1' }]);
  const accounts = memAccounts([{ id: 'a', lastUsedAt: 990 }]);
  const slept = [];
  const pool = makePool({ tasks, accounts, run: async () => ['/x.mp4'], extra: { gap: () => 15000, sleep: async ms => { slept.push(ms); } } });
  await pool.runOne(tasks.get('t1'), 'a');
  assert.ok(slept.includes(14990));
});

test('cancel: huỷ phiên trên Muse nếu đã gửi', () => {
  const tasks = memTasks([{ id: 't1', status: 'processing', sessionId: 's', accountId: 'a' }]);
  let cancelled = '';
  const pool = makePool({ tasks, accounts: memAccounts([{ id: 'a' }]), page: { ...pageOk, cancel: async sid => { cancelled = sid; } }, run: async () => [] });
  pool.cancel('t1');
  assert.equal(tasks.get('t1').status, 'cancelled');
  assert.equal(cancelled, 's');
});

test('skip: task của dự án tạm dừng không được chia', async () => {
  const tasks = memTasks([{ id: 't1', project: 'p1' }]);
  let ran = false;
  const pool = makePool({ tasks, accounts: memAccounts([{ id: 'a' }]), run: async () => { ran = true; return []; }, extra: { skip: t => t.project === 'p1' } });
  pool.pump();
  await settle();
  assert.equal(ran, false);
});

test('releaseAccount: task dở của TK bị xoá → gửi lại từ đầu', () => {
  const tasks = memTasks([{ id: 't1', status: 'processing', sessionId: 's', accountId: 'a' }]);
  const pool = makePool({ tasks, accounts: memAccounts([{ id: 'a' }]), run: async () => [] });
  pool.releaseAccount('a');
  assert.equal(tasks.get('t1').status, 'queued');
  assert.equal(tasks.get('t1').sessionId, '');
});
