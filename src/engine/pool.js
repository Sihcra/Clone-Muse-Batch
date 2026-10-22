'use strict';
/**
 * POOL — chạy song song task trên nhiều tài khoản Muse. Scheduler chọn cặp task → tài khoản,
 * Pool gắn task vào trang Muse của tài khoản đó và chạy runTask.
 * Không phụ thuộc Electron: store, trang Muse, runTask, sleep, now đều truyền vào.
 */

const { plan, pausedUntil } = require('./scheduler');
const { runTask, failurePatch } = require('./muse-runner');

const realSleep = ms => new Promise(r => setTimeout(r, ms));
// Nghỉ ngẫu nhiên 15–20s giữa 2 lần gửi trên cùng 1 tài khoản: gửi dồn dập dễ bị Muse nghi là tool.
const randomGap = () => 15e3 + Math.random() * 5e3;

class Pool {
  /**
   * skip(task) → true: task chờ chưa được chạy (dự án đang tạm dừng).
   * config() → { outputDir, maxAttempts, limits: { image, video } } đọc lại mỗi task.
   */
  constructor({ tasks, accounts, pageFor, config, loadImage, onFiles = () => {}, run = runTask, sleep = realSleep, now = Date.now, skip = () => false, gap = randomGap }) {
    Object.assign(this, { tasks, accounts, pageFor, config, loadImage, onFiles, run, sleep, now, skip, gap });
    this.running = new Map(); // taskId → accountId
  }

  busy(accId) {
    let n = 0;
    for (const id of this.running.values()) if (id === accId) n++;
    return n;
  }

  pump() {
    const tasks = this.tasks.list().filter(t => t.status !== 'queued' || !this.skip(t));
    const pairs = plan({ tasks, accounts: this.accounts.list(), settings: this.accounts.settings, running: this.running, now: this.now() });
    for (const { taskId, accountId } of pairs) this.runOne(this.tasks.get(taskId), accountId);
  }

  // Trang vừa mở còn đang tải → login() báo chưa; dò thêm (mặc định ~1 phút) trước khi kết luận
  async checkLogin(accId, tries = 20) {
    const page = this.pageFor(accId);
    for (let i = 0; i < tries; i++) {
      // Lần đầu được phép mở Chrome; sau đó người dùng đóng Chrome → thôi, không mở lại
      if (i && page.chrome?.running === false) break;
      if ((await page.login().catch(() => null))?.loggedIn) {
        if (this.accounts.get(accId)?.loggedIn !== true) this.accounts.update(accId, { loggedIn: true });
        return true;
      }
      if (i < tries - 1) await this.sleep(3000);
    }
    if (this.accounts.get(accId)) this.accounts.update(accId, { loggedIn: false });
    return false;
  }

  async refreshQuota(accId) {
    const q = await this.pageFor(accId).quota().catch(() => null);
    if (q && this.accounts.get(accId)) this.accounts.update(accId, { quota: q });
    return q;
  }

  async runOne(task, accId) {
    const id = task.id;
    this.running.set(id, accId);
    const page = this.pageFor(accId);
    const isLive = () => this.tasks.get(id)?.status === 'processing';
    const cfg = this.config();
    const kind = task.kind;
    const prevAttempts = task.attempts; // store trả đúng object → chụp lại trước khi update
    let finished = false;
    try {
      if (task.status === 'queued') {
        // Giữ chỗ trước khi dò đăng nhập: pump() chạy chồng không lấy lại task này
        this.tasks.update(id, {
          status: 'processing', progress: 5, accountId: accId, step: 'Kiểm tra đăng nhập', startedAt: this.now(), finishedAt: 0,
          attempts: prevAttempts + 1, error: '', files: [], sessionId: '', held: false
        });
        if (!(await this.checkLogin(accId))) {
          if (isLive()) {
            this.tasks.update(id, {
              status: 'queued', progress: 0, accountId: '', step: '', attempts: prevAttempts,
              error: `${this.accounts.get(accId)?.name || accId} chưa đăng nhập Muse`
            });
          }
          return;
        }
        const wait = (this.accounts.get(accId)?.lastUsedAt || 0) + this.gap() - this.now();
        if (wait > 0) {
          this.tasks.update(id, { step: `Nghỉ ~${Math.ceil(wait / 1000)}s rồi mới gửi (tránh gửi dồn)` });
          await this.sleep(wait);
          if (!isLive()) return;
        }
      }
      const files = await this.run(this.tasks.get(id), {
        page, accountId: accId, update: p => this.tasks.update(id, p), isLive,
        outputDir: cfg.outputDir, loadImage: this.loadImage, limits: cfg.limits
      });
      finished = true;
      if (!files || !isLive()) return;
      // Ảnh xong → ghi link chat để video làm tiếp trong cùng chat (link chat Muse = /thread/<sessionId>)
      const sid = this.tasks.get(id).sessionId;
      this.tasks.update(id, {
        status: 'succeeded', progress: 100, step: `Đã tải ${files.length} file`, finishedAt: this.now(), files,
        ...(kind === 'image' && sid ?{ thread: `https://muse.ai/thread/${sid}` } : {})
      });
      this.onFiles(files);
    } catch (e) {
      if (!isLive()) return;
      // Muse không nhận lệnh có thể do hết hạn mức → đọc lại hạn mức; TK phải nghỉ thì trả task về hàng đợi, không tính lượt
      if (/^Muse không nhận lệnh/.test(e.message)) {
        await this.refreshQuota(accId);
        const acc = this.accounts.get(accId);
        if (acc && pausedUntil(acc, this.accounts.settings, this.now())) {
          const t = this.tasks.get(id);
          this.tasks.update(id, { status: 'queued', accountId: '', sessionId: '', step: '', progress: 0, attempts: Math.max(0, t.attempts - 1), error: `${acc.name} hết hạn mức, chờ tài khoản khác` });
          return;
        }
      }
      this.tasks.update(id, { progress: 0, ...failurePatch(this.tasks.get(id), e, this.now(), cfg.maxAttempts) });
    } finally {
      this.running.delete(id);
      if (this.accounts.get(accId)) {
        this.accounts.update(accId, { lastUsedAt: this.now() });
        if (finished) this.refreshQuota(accId); // không chặn
      }
      setImmediate(() => this.pump());
    }
  }

  cancel(id) {
    const task = this.tasks.get(id);
    if (!task || (task.status !== 'queued' && task.status !== 'processing')) return task || null;
    if (task.status === 'processing' && task.sessionId) this.pageFor(task.accountId || 'default').cancel(task.sessionId).catch(() => {});
    this.tasks.update(id, { status: 'cancelled', progress: 0, error: 'Đã huỷ', finishedAt: this.now() });
    return task;
  }

  // Trước khi xoá tài khoản: task dở của nó không dò tiếp được → gửi lại từ đầu trên tài khoản khác
  releaseAccount(accId) {
    for (const t of this.tasks.list()) {
      if (t.status === 'processing' && (t.accountId || 'default') === accId && !this.running.has(t.id)) {
        this.tasks.update(t.id, { status: 'queued', sessionId: '', accountId: '', step: '', error: 'Tài khoản đã xoá, gửi lại' });
      }
    }
  }
}

module.exports = { Pool, randomGap };
