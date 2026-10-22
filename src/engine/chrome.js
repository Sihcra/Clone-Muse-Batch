'use strict';
/**
 * CHROME — mở Google Chrome thật của máy (có giao diện, không headless) với profile riêng từng tài khoản,
 * điều khiển bằng CDP qua pipe (--remote-debugging-pipe): fd 3 = app gửi lệnh, fd 4 = Chrome trả lời,
 * mỗi tin là 1 JSON kết thúc bằng \0. Không mở cổng mạng nào.
 * Chrome 136+ chặn điều khiển profile mặc định → bắt buộc --user-data-dir riêng.
 */

const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const IS_MAC = process.platform === 'darwin';

function findChrome() {
  if (IS_MAC) return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (fs.existsSync(p)) return p;
  }
  return 'chrome.exe';
}
const CHROME_PATH = findChrome();

// Windows không "ẩn app" được như Mac → đẩy cửa sổ ra ngoài màn hình. Cửa sổ vẫn "hiện" nên JS chạy bình thường.
const OFFSCREEN = { left: -32000, top: -32000 };
const SHOWN = { left: 80, top: 40, width: 1200, height: 860 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// macOS: ẩn/hiện cả app Chrome theo PID qua JXA (như Cmd+H) — không cửa sổ, không xuống Dock.
const jxa = (pid, body, done = () => {}) => execFile('osascript', ['-l', 'JavaScript', '-e',
  `ObjC.import('AppKit'); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); ${body}`], done);
const jxaAsync = (pid, body) => new Promise(r => jxa(pid, body, () => r()));
// app.hidden chỉ cập nhật khi run loop chạy
const RUNLOOP = '$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25))';

// Chrome ẩn/thu nhỏ: trang mới tải báo document.hidden và không chạy requestAnimationFrame → Muse (Next.js)
// không dựng xong, mất client chat. Nạp trước mỗi trang: luôn báo "visible", rAF có setTimeout 16ms dự phòng.
const VISIBILITY_SHIM = `(() => {
  const def = (k, v) => Object.defineProperty(Document.prototype, k, { get: () => v, configurable: true });
  def('visibilityState', 'visible');
  def('hidden', false);
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  const live = new Map();
  let seq = 0;
  window.requestAnimationFrame = cb => {
    const id = ++seq;
    let fired = false;
    const run = ts => { if (fired) return; fired = true; live.delete(id); cb(ts); };
    live.set(id, [nativeRaf(run), setTimeout(() => run(performance.now()), 16)]);
    return id;
  };
  window.cancelAnimationFrame = id => {
    const h = live.get(id);
    if (!h) return;
    nativeCaf(h[0]);
    clearTimeout(h[1]);
    live.delete(id);
  };
})();`;

class Chrome extends EventEmitter {
  /**
   * proxy: { server: 'http://ip:port' | 'socks5://ip:port', username, password, host, port, line }
   * resolveProxy: async () => proxy | null — hỏi lại mỗi lần mở Chrome, nên đổi proxy chỉ cần đóng Chrome.
   */
  constructor({ profileDir, url, chromePath = CHROME_PATH, proxy = null, resolveProxy = null }) {
    super();
    Object.assign(this, { profileDir, url, chromePath, proxy, resolveProxy });
    this.proc = null;
    this.sessionId = '';
    this.targetId = '';
    this.seq = 0;
    this.pending = new Map();
    this.starting = null;
  }

  // Sẵn sàng = process còn sống VÀ đang gắn vào 1 tab (Mac: đóng cửa sổ thì Chrome vẫn chạy nhưng mất tab).
  get running() {
    return Boolean(this.proc && this.sessionId);
  }

  // Nhiều chỗ gọi cùng lúc (lúc mở app) → dùng chung 1 lần mở
  start() {
    if (!this.starting) this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }

  async launch() {
    if (this.proc) return this.attach();
    if (!fs.existsSync(this.chromePath)) throw new Error('Không tìm thấy Google Chrome — cài Google Chrome rồi mở lại app');
    fs.mkdirSync(this.profileDir, { recursive: true });
    if (this.resolveProxy) this.proxy = await this.resolveProxy();

    const args = [
      `--user-data-dir=${this.profileDir}`,
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      // Chrome nằm ngoài màn hình vẫn phải chạy timer/JS bình thường để dò phiên Muse
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      ...(this.proxy ? [`--proxy-server=${this.proxy.server}`] : []),
      ...(IS_MAC ? [] : [`--window-position=${OFFSCREEN.left},${OFFSCREEN.top}`]),
      'about:blank' // trang trắng trước, gắn shim rồi mới vào Muse
    ];
    const proc = spawn(this.chromePath, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    this.proc = proc;

    let buf = '';
    proc.stdio[4].on('data', chunk => {
      buf += chunk.toString('utf8');
      let end;
      while ((end = buf.indexOf('\0')) >= 0) {
        const raw = buf.slice(0, end);
        buf = buf.slice(end + 1);
        let msg;
        try { msg = JSON.parse(raw); } catch { continue; }
        this.onMessage(msg);
      }
    });
    proc.stdio[3].on('error', () => {});
    proc.once('error', () => this.onExit(proc));
    proc.once('exit', () => this.onExit(proc));

    try {
      // Proxy có user/pass: bắt yêu cầu đăng nhập proxy ở cấp trình duyệt rồi trả lời qua CDP Fetch
      if (this.proxy?.username) await this.cmd('Fetch.enable', { handleAuthRequests: true, patterns: [{ urlPattern: '*' }] });
      await this.attach();
      await this.hide();
      // Mac: Chrome mới mở hay tự hiện lại sau 1–2s → canh ~10s, hiện thì ẩn lại; show() sẽ dừng canh
      if (IS_MAC) this.guard = jxa(proc.pid, `app.hide; for (let i = 0; i < 40; i++) { ${RUNLOOP}; if (!app.hidden) app.hide; }`);
      await this.cmd('Page.navigate', { url: this.url }, this.sessionId);
    } catch (e) {
      await this.close();
      throw e;
    }
  }

  onMessage(msg) {
    // Tab Muse bị đóng → bỏ phiên, lần gọi sau start() tự gắn lại
    if (msg.method === 'Target.detachedFromTarget' && msg.params?.sessionId === this.sessionId) this.sessionId = '';
    if (msg.method && msg.method.startsWith('Fetch.')) this.onFetch(msg);
    if (msg.id === undefined) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }

  // Gắn vào tab muse.ai (hoặc tab trang đầu tiên); không có tab nào → tạo tab mới
  async attach() {
    let target = null;
    for (let i = 0; i < 10 && !target; i++) {
      const { targetInfos } = await this.cmd('Target.getTargets');
      const pages = targetInfos.filter(t => t.type === 'page');
      target = pages.find(t => t.url.includes('muse.ai')) || pages[0] || null;
      if (!target) await sleep(200);
    }
    const targetId = target ? target.targetId : (await this.cmd('Target.createTarget', { url: this.url })).targetId;
    const { sessionId } = await this.cmd('Target.attachToTarget', { targetId, flatten: true });
    await this.cmd('Page.enable', {}, sessionId); // thiếu Page.enable thì script nạp trước không chạy
    await this.cmd('Page.addScriptToEvaluateOnNewDocument', { source: VISIBILITY_SHIM }, sessionId);
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  onFetch({ method, params, sessionId }) {
    const { requestId } = params;
    let reply;
    if (method === 'Fetch.authRequired') {
      const fromProxy = params.authChallenge?.source === 'Proxy';
      reply = this.cmd('Fetch.continueWithAuth', {
        requestId,
        authChallengeResponse: fromProxy
          ? { response: 'ProvideCredentials', username: this.proxy?.username || '', password: this.proxy?.password || '' }
          : { response: 'Default' }
      }, sessionId);
    } else {
      reply = this.cmd('Fetch.continueRequest', { requestId }, sessionId);
    }
    reply.catch(() => {});
  }

  onExit(proc) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.sessionId = '';
    for (const p of this.pending.values()) p.reject(new Error('Chrome đã đóng'));
    this.pending.clear();
    this.emit('exit');
  }

  // Lệnh CDP. Có sessionId = lệnh cho tab Muse, không có = lệnh cho cả trình duyệt. Quá hạn → lỗi, không chờ mãi.
  cmd(method, params = {}, sessionId, timeoutMs = 60e3) {
    if (!this.proc) return Promise.reject(new Error('Chrome đã đóng'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome không trả lời ${method} (quá ${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.proc.stdio[3].write(JSON.stringify(msg) + '\0');
    });
  }

  async evaluate(expression, timeoutMs) {
    if (this.proc && !this.sessionId) throw new Error('Chrome mất tab Muse');
    const r = await this.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'Lỗi chạy script trong trang');
    return r.result.value;
  }

  // Chrome không cho đặt vị trí khi đang thu nhỏ/phóng to → về 'normal' trước
  async setWindow(bounds) {
    const { windowId } = await this.cmd('Browser.getWindowForTarget', { targetId: this.targetId });
    await this.cmd('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    if (bounds) await this.cmd('Browser.setWindowBounds', { windowId, bounds });
  }

  async show() {
    if (this.guard) { this.guard.kill(); this.guard = null; }
    if (IS_MAC) await jxaAsync(this.proc.pid, 'app.unhide');
    await this.setWindow(IS_MAC ? null : SHOWN);
    await this.cmd('Target.activateTarget', { targetId: this.targetId });
    if (IS_MAC) await jxaAsync(this.proc.pid, 'app.activateWithOptions(2)');
  }

  hide() {
    if (!this.proc) return Promise.resolve();
    if (!IS_MAC) return this.setWindow(OFFSCREEN);
    // Chrome vừa mở chưa khởi động xong thì lệnh hide bị bỏ qua → thử lại tới khi ẩn (~10s)
    return jxaAsync(this.proc.pid, `app.hide; for (let i = 0; i < 40 && !app.hidden; i++) { ${RUNLOOP}; app.hide; }`);
  }

  async clearSiteData(origin) {
    await this.cmd('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    await this.cmd('Page.navigate', { url: this.url }, this.sessionId);
  }

  async close() {
    const proc = this.proc;
    if (!proc) return;
    const exited = new Promise(r => proc.once('exit', r));
    this.cmd('Browser.close').catch(() => {});
    const killer = setTimeout(() => { try { proc.kill(); } catch {} }, 3000);
    await exited;
    clearTimeout(killer);
  }
}

module.exports = { Chrome, CHROME_PATH, VISIBILITY_SHIM };
