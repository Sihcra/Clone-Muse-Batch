'use strict';
/**
 * TASK STORE — lịch sử task, lưu ở userData/tasks.json (còn nguyên sau khi tắt app).
 * Trạng thái: queued → processing → succeeded | failed | cancelled.
 * Ảnh data: được ghi ra userData/task-images/ để JSON nhẹ và chạy lại được sau khi mở lại app.
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { writeJsonAtomic, readJson } = require('./fs-util');

const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const MAX_TASKS = 500; // ghi lại cả file mỗi lần đổi → giữ vừa phải
const ID_RE = /^[\w-]{1,40}$/;
const THREAD_RE = /^https:\/\/muse\.ai\/thread\/[\w-]+$/;

class TaskStore extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'tasks.json');
    this.imgDir = path.join(dir, 'task-images');
    const data = readJson(this.file, []);
    this.tasks = Array.isArray(data) ? data : [];
    // Task dở lúc tắt app: đã gửi Muse (có sessionId) → dò tiếp phiên đó; chưa gửi → xếp hàng lại.
    for (const t of this.tasks) if (t.status === 'processing' && !t.sessionId) t.status = 'queued';
    this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    clearTimeout(this.saveTimer);
    try {
      writeJsonAtomic(this.file, this.tasks);
    } catch (e) {
      console.error('[TaskStore] Không ghi được tasks.json:', e.message);
    }
  }

  list(status) {
    return status ? this.tasks.filter(t => t.status === status) : this.tasks;
  }

  get(id) {
    return this.tasks.find(t => t.id === id);
  }

  // Ảnh đầu vào → { imageUrl, imageLocalPath } lưu được lâu dài
  saveImage(img, id, k) {
    const data = img.imageBase64 || img.dataUrl || '';
    const m = /^data:image\/(\w+);base64,(.*)$/s.exec(data);
    const local = img.imageLocalPath || '';
    if (m) {
      const file = path.join(this.imgDir, `${id}_${k}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      return { imageUrl: '', imageLocalPath: file };
    }
    // Ảnh của task khác (Tạo lại / Sửa) hoặc của Tư liệu → chép riêng, vì xoá bên kia sẽ xoá mất ảnh
    const shared = local.startsWith(this.imgDir) || local.includes(`${path.sep}studio-images${path.sep}`);
    if (shared && fs.existsSync(local)) {
      const file = path.join(this.imgDir, `${id}_${k}${path.extname(local)}`);
      fs.copyFileSync(local, file);
      return { imageUrl: '', imageLocalPath: file };
    }
    return { imageUrl: img.imageUrl || '', imageLocalPath: local };
  }

  /**
   * kind 'image': Muse tạo ảnh (storyboard), lấy `expect` ảnh. thread: làm tiếp trong chat Muse có sẵn.
   * account: tài khoản giữ chat `thread` (chat thuộc về tài khoản). held: chỉ thêm vào hàng đợi, chưa chạy.
   */
  add({ prompt, images = [], timeoutMin = 10, source = 'ui', label = '', kind = 'video', expect = 1, thread = '', account = '', ratio = '', held = false, project = 'default' }) {
    const id = 'task_' + crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(this.imgDir, { recursive: true });
    const saved = (Array.isArray(images) ? images : []).map((img, k) => this.saveImage(img || {}, id, k));
    const task = {
      id,
      source,
      label: String(label || '').slice(0, 120),
      prompt: String(prompt || ''),
      images: saved,
      kind: kind === 'image' ? 'image' : 'video',
      expect: Math.min(Math.max(parseInt(expect, 10) || 1, 1), 6),
      ratio: RATIOS.includes(ratio) ? ratio : '',
      sessionId: '',
      accountId: '',
      held: held === true,
      project: ID_RE.test(project) ? project : 'default',
      thread: THREAD_RE.test(thread) ? thread : '',
      pin: ID_RE.test(account) ? account : '',
      timeoutMin: Math.min(Math.max(Number(timeoutMin) || 10, 2), 60),
      status: 'queued',
      attempts: 0,
      progress: 0,
      step: '',
      createdAt: Date.now(),
      startedAt: 0,
      finishedAt: 0,
      files: [],
      error: ''
    };
    this.tasks.unshift(task);
    // Vượt giới hạn → bỏ bớt task cũ nhất đã kết thúc
    while (this.tasks.length > MAX_TASKS) {
      const i = this.tasks.findLastIndex(t => t.status !== 'queued' && t.status !== 'processing');
      if (i < 0) break;
      this.remove(this.tasks[i].id);
    }
    this.save();
    this.emit('update', task);
    return task;
  }

  update(id, patch) {
    const task = this.get(id);
    if (!task) return null;
    Object.assign(task, patch);
    this.save();
    this.emit('update', task);
    return task;
  }

  remove(id) {
    const task = this.get(id);
    if (!task) return false;
    for (const img of task.images) {
      if (img.imageLocalPath && img.imageLocalPath.startsWith(this.imgDir)) fs.unlink(img.imageLocalPath, () => {});
    }
    this.tasks = this.tasks.filter(t => t !== task);
    this.save();
    this.emit('update', { id, removed: true });
    return true;
  }
}

module.exports = { TaskStore, RATIOS, MAX_TASKS };
