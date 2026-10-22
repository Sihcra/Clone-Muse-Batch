'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TaskStore, MAX_TASKS } = require('../src/engine/task-store');
const { StudioStore } = require('../src/engine/studio-store');
const { AccountStore } = require('../src/engine/accounts');
const { Config } = require('../src/engine/config');
const { tmpDir } = require('./helpers');

const PNG = 'data:image/png;base64,' + Buffer.from('fakepng').toString('base64');

test('TaskStore: thêm task, ảnh data ghi ra file, lưu và đọc lại', () => {
  const dir = tmpDir();
  const s = new TaskStore(dir);
  const t = s.add({ prompt: 'p', images: [{ imageBase64: PNG }, { imageUrl: 'https://x/y.jpg' }], ratio: '16:9', kind: 'image', expect: 9, project: 'prj_1' });
  assert.match(t.id, /^task_[0-9a-f]{16}$/);
  assert.equal(t.expect, 6);
  assert.equal(t.ratio, '16:9');
  assert.ok(fs.existsSync(t.images[0].imageLocalPath));
  assert.equal(t.images[1].imageUrl, 'https://x/y.jpg');
  s.flush();
  const again = new TaskStore(dir);
  assert.equal(again.get(t.id).prompt, 'p');
});

test('TaskStore: thread/account/ratio sai bị bỏ', () => {
  const s = new TaskStore(tmpDir());
  const t = s.add({ prompt: 'p', thread: 'https://evil/x', account: '../x', ratio: '2:1', project: '../x' });
  assert.deepEqual([t.thread, t.pin, t.ratio, t.project], ['', '', '', 'default']);
  const ok = s.add({ prompt: 'p', thread: 'https://muse.ai/thread/abc-1', account: 'acc_1' });
  assert.deepEqual([ok.thread, ok.pin], ['https://muse.ai/thread/abc-1', 'acc_1']);
});

test('TaskStore: mở lại app → task đang chạy chưa gửi thì xếp hàng lại, đã gửi thì giữ', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([
    { id: 'a', status: 'processing', sessionId: '', images: [], files: [] },
    { id: 'b', status: 'processing', sessionId: 's', images: [], files: [] }
  ]));
  const s = new TaskStore(dir);
  assert.equal(s.get('a').status, 'queued');
  assert.equal(s.get('b').status, 'processing');
});

test('TaskStore: xoá task xoá luôn ảnh riêng; vượt giới hạn bỏ task cũ đã xong', () => {
  const s = new TaskStore(tmpDir());
  const t = s.add({ prompt: 'p', images: [{ imageBase64: PNG }] });
  const img = t.images[0].imageLocalPath;
  s.remove(t.id);
  return new Promise(r => setTimeout(r, 30)).then(() => {
    assert.equal(fs.existsSync(img), false);
    const first = s.add({ prompt: 'old' });
    s.update(first.id, { status: 'succeeded' });
    for (let i = 0; i < MAX_TASKS; i++) s.add({ prompt: 'x' + i });
    assert.equal(s.list().length, MAX_TASKS);
    assert.equal(s.get(first.id), undefined);
  });
});

test('StudioStore: dự án, ảnh chép vào studio-images, bỏ ảnh thì xoá file', async () => {
  const dir = tmpDir();
  const s = new StudioStore(dir);
  assert.equal(s.get().projects[0].id, 'default');
  const p = s.addProject('Noel');
  s.setCurrent(p.id);
  s.updateProject(p.id, { paused: true });
  assert.ok(s.pausedProjects().has(p.id));
  const img = s.addImage({ dataUrl: PNG });
  assert.ok(img.startsWith(path.join(dir, 'studio-images')));
  s.save({ model: { on: true, images: [img, '/outside.png'] } });
  assert.deepEqual(s.get().model.images, [img]);
  s.save({ model: { on: false, images: [] } });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(fs.existsSync(img), false);
  assert.equal(s.removeProject('default'), false);
  assert.equal(s.removeProject(p.id), true);
  assert.equal(s.get().current, 'default');
  assert.equal(new StudioStore(dir).get().projects.length, 1);
});

test('AccountStore: luôn còn 1 tài khoản, giới hạn số luồng, cài đặt kẹp trong khoảng', () => {
  const dir = tmpDir();
  const s = new AccountStore(dir);
  assert.equal(s.list()[0].id, 'default');
  assert.equal(s.remove('default'), false);
  const a = s.add('');
  assert.equal(a.name, 'Tài khoản 2');
  assert.equal(s.update(a.id, { threads: 99 }).threads, 5);
  assert.equal(s.setSettings({ totalThreads: 0, maxAccounts: 500, mode: 'x' }).maxAccounts, 20);
  assert.equal(s.settings.mode, 'rotate');
  s.flush();
  assert.equal(new AccountStore(dir).list().length, 2);
});

test('Config: lưu và đọc lại', () => {
  const dir = tmpDir();
  new Config(dir).save({ apiKey: 'k', maxAttempts: 3 });
  assert.equal(new Config(dir).get().apiKey, 'k');
});
