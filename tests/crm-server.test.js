'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CrmServer } = require('../src/engine/crm-server');
const { tmpDir } = require('./helpers');

async function withServer(fn) {
  const dir = tmpDir();
  const file = path.join(dir, 'v.mp4');
  fs.writeFileSync(file, 'MP4DATA');
  const tasks = [];
  const store = {
    list: s => tasks.filter(t => !s || t.status === s),
    get: id => tasks.find(t => t.id === id),
    submit: input => { const t = { id: 'task_' + (tasks.length + 1).toString(16).padStart(4, '0'), status: 'queued', images: input.images, files: [], ...input }; tasks.push(t); return t; },
    cancel: id => Object.assign(store.get(id), { status: 'cancelled' }),
    retry: id => Object.assign(store.get(id), { status: 'queued' }),
    remove: id => { const i = tasks.findIndex(t => t.id === id); tasks.splice(i, 1); return i >= 0; }
  };
  const crm = new CrmServer(0, { apiKey: () => 'secret', tasks: store, onJobReceived: j => store.submit({ prompt: j.prompt, source: 'crm' }) });
  await crm.start();
  const base = `http://127.0.0.1:${crm.server.address().port}`;
  try { await fn({ base, tasks, file }); } finally { crm.stop(); }
}
const auth = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };

test('API v1: thiếu/sai key → 401', () => withServer(async ({ base }) => {
  assert.equal((await fetch(`${base}/api/v1/tasks`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/tasks`, { headers: { 'X-API-Key': 'nope' } })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/tasks`, { headers: { 'X-API-Key': 'secret' } })).status, 200);
}));

test('API v1: tạo, xem, huỷ, chạy lại, tải file, xoá', () => withServer(async ({ base, tasks, file }) => {
  const r = await fetch(`${base}/api/v1/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ prompt: 'x', images: [{ imageUrl: 'https://a/b.jpg' }, { imageUrl: 'file:///etc' }] }) });
  assert.equal(r.status, 201);
  const { task } = await r.json();
  assert.equal(task.images, 1); // chỉ trả số ảnh, không lộ đường dẫn
  const id = task.id;
  assert.equal((await (await fetch(`${base}/api/v1/tasks/${id}`, { headers: auth })).json()).task.prompt, 'x');
  assert.equal((await (await fetch(`${base}/api/v1/tasks/${id}/cancel`, { method: 'POST', headers: auth })).json()).task.status, 'cancelled');
  assert.equal((await (await fetch(`${base}/api/v1/tasks/${id}/retry`, { method: 'POST', headers: auth })).json()).task.status, 'queued');
  assert.equal((await fetch(`${base}/api/v1/tasks/${id}/file`, { headers: auth })).status, 404);
  tasks[0].files = [file];
  const f = await fetch(`${base}/api/v1/tasks/${id}/file?i=0`, { headers: auth });
  assert.equal(f.headers.get('content-type'), 'video/mp4');
  assert.equal(await f.text(), 'MP4DATA');
  assert.equal((await (await fetch(`${base}/api/v1/tasks/${id}`, { method: 'DELETE', headers: auth })).json()).success, true);
  assert.equal((await fetch(`${base}/api/v1/tasks/${id}`, { headers: auth })).status, 404);
}));

test('API v1: thiếu prompt / JSON hỏng → 400', () => withServer(async ({ base }) => {
  assert.equal((await fetch(`${base}/api/v1/tasks`, { method: 'POST', headers: auth, body: '{}' })).status, 400);
  assert.equal((await fetch(`${base}/api/v1/tasks`, { method: 'POST', headers: auth, body: '{bad' })).status, 400);
}));

test('API cũ CRM: /api/render không cần key, /api/status chạy', () => withServer(async ({ base, tasks }) => {
  const r = await (await fetch(`${base}/api/render`, { method: 'POST', body: JSON.stringify({ topicId: 'x', prompt: 'p' }) })).json();
  assert.equal(r.success, true);
  assert.equal(tasks[0].source, 'crm');
  assert.equal((await (await fetch(`${base}/api/status`)).json()).app, 'MuseBatch Studio');
}));
