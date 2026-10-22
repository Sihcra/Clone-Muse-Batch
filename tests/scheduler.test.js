'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, pausedUntil, weeklyOut, usable } = require('../src/engine/scheduler');

const S = { maxAccounts: 5, totalThreads: 5, mode: 'rotate', useTopup: true, keepGoing: false };
const acc = (id, extra = {}) => ({ id, enabled: true, threads: 1, loggedIn: true, quota: null, lastUsedAt: 0, ...extra });
const task = (id, extra = {}) => ({ id, status: 'queued', createdAt: 0, sessionId: '', accountId: '', ...extra });

test('weeklyOut: 100% hoặc trạng thái hết', () => {
  assert.equal(weeklyOut(null), false);
  assert.equal(weeklyOut({ pct: 100 }), true);
  assert.equal(weeklyOut({ pct: 20, status: 'EXHAUSTED' }), true);
  assert.equal(weeklyOut({ pct: 90, status: 'LOW' }), false);
});

test('pausedUntil: còn token bổ sung thì không nghỉ, keepGoing thì không nghỉ, qua mốc đặt lại thì không nghỉ', () => {
  const now = 1000;
  const out = { pct: 100, resetsAt: 5000, topupLeft: 0 };
  assert.equal(pausedUntil({ quota: out }, S, now), 5000);
  assert.equal(pausedUntil({ quota: { ...out, topupLeft: 0.4 } }, S, now), 0);
  assert.equal(pausedUntil({ quota: { ...out, topupLeft: 0.4 } }, { ...S, useTopup: false }, now), 5000);
  assert.equal(pausedUntil({ quota: out }, { ...S, keepGoing: true }, now), 0);
  assert.equal(pausedUntil({ quota: { ...out, resetsAt: 500 } }, S, now), 0);
  assert.equal(pausedUntil({ quota: { pct: 100 } }, S, now), Infinity);
});

test('usable: tắt / chưa đăng nhập / đang nghỉ thì không dùng', () => {
  assert.equal(usable(acc('a'), S, 0), true);
  assert.equal(usable(acc('a', { enabled: false }), S, 0), false);
  assert.equal(usable(acc('a', { loggedIn: false }), S, 0), false);
  assert.equal(usable(acc('a', { loggedIn: null }), S, 0), true);
  assert.equal(usable(acc('a', { quota: { pct: 100, resetsAt: 99 } }), S, 0), false);
});

test('task dở chỉ dò tiếp trên đúng tài khoản đã gửi', () => {
  const out = plan({
    tasks: [task('t1', { status: 'processing', sessionId: 's', accountId: 'b' })],
    accounts: [acc('a'), acc('b')], settings: S, running: new Map(), now: 0
  });
  assert.deepEqual(out, [{ taskId: 't1', accountId: 'b' }]);
});

test('chia task cho tài khoản ít việc → ít hạn mức đã dùng → lâu chưa dùng', () => {
  const out = plan({
    tasks: [task('t1', { createdAt: 1 }), task('t2', { createdAt: 2 })],
    accounts: [acc('a', { quota: { pct: 50 } }), acc('b', { quota: { pct: 10 } })], settings: S, running: new Map(), now: 0
  });
  assert.deepEqual(out, [{ taskId: 't1', accountId: 'b' }, { taskId: 't2', accountId: 'a' }]);
});

test('chế độ Lần lượt giữ thứ tự danh sách, tôn trọng số luồng từng TK', () => {
  const out = plan({
    tasks: [task('t1', { createdAt: 1 }), task('t2', { createdAt: 2 }), task('t3', { createdAt: 3 })],
    accounts: [acc('a', { threads: 2, quota: { pct: 90 } }), acc('b')], settings: { ...S, mode: 'sequential' }, running: new Map(), now: 0
  });
  assert.deepEqual(out.map(p => p.accountId), ['a', 'a', 'b']);
});

test('giới hạn tổng luồng và số tài khoản chạy đồng thời', () => {
  const tasks = [1, 2, 3, 4].map(i => task('t' + i, { createdAt: i }));
  const accounts = [acc('a', { threads: 3 }), acc('b', { threads: 3 })];
  assert.equal(plan({ tasks, accounts, settings: { ...S, totalThreads: 2 }, running: new Map(), now: 0 }).length, 2);
  const one = plan({ tasks, accounts, settings: { ...S, maxAccounts: 1 }, running: new Map(), now: 0 });
  assert.equal(new Set(one.map(p => p.accountId)).size, 1);
});

test('task giữ (held) không chạy; task đang chạy không bị chia lại', () => {
  const out = plan({
    tasks: [task('t1', { held: true }), task('t2', { createdAt: 1 })],
    accounts: [acc('a', { threads: 2 })], settings: S, running: new Map([['t2', 'a']]), now: 0
  });
  assert.deepEqual(out, []);
});

test('task làm tiếp chat cũ chờ đúng tài khoản giữ chat; TK đó hỏng thì TK khác làm', () => {
  const pinned = task('t1', { thread: 'https://muse.ai/thread/x', pin: 'b' });
  const busyB = plan({ tasks: [pinned, task('t2', { createdAt: 1 })], accounts: [acc('a'), acc('b')], settings: S, running: new Map([['zz', 'b']]), now: 0 });
  assert.deepEqual(busyB, [{ taskId: 't2', accountId: 'a' }]);
  const deadB = plan({ tasks: [pinned], accounts: [acc('a'), acc('b', { loggedIn: false })], settings: S, running: new Map(), now: 0 });
  assert.deepEqual(deadB, [{ taskId: 't1', accountId: 'a' }]);
});
