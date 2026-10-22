'use strict';
/**
 * MUSEBATCH STUDIO — main process.
 * Cửa sổ Studio + mỗi tài khoản Muse 1 Google Chrome thật (profile riêng, CDP qua pipe) + pool chạy task song song
 * + API nội bộ 127.0.0.1:48900. Không có bản quyền/kích hoạt key, không có đăng Facebook.
 */

const { app, BrowserWindow, ipcMain, shell, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const { CrmServer } = require('./engine/crm-server');
const { scrapeLadiPage } = require('./engine/ladi-crawler');
const { generateScriptsFromProduct } = require('./engine/product-ai');
const { Config } = require('./engine/config');
const { TaskStore } = require('./engine/task-store');
const { Chrome } = require('./engine/chrome');
const { MusePage } = require('./engine/muse-page');
const { ensureLogin } = require('./engine/muse-runner');
const { AccountStore } = require('./engine/accounts');
const { parseProxy, parseList, checkProxy, pickProxy } = require('./engine/proxy');
const { Pool } = require('./engine/pool');
const { StudioStore } = require('./engine/studio-store');
const merger = require('./engine/merge');
const { usable, pausedUntil } = require('./engine/scheduler');

const IS_MAC = process.platform === 'darwin';
const API_PORT = 48900;
const MUSE_URL = 'https://muse.ai';
const VERSION = require('../package.json').version;

let mainWindow = null;
let crmServer = null;
let config = null;
let taskStore = null;
let accountStore = null;
let studioStore = null;
let pool = null;
const pages = new Map(); // accountId → MusePage

const userDir = () => app.getPath('userData');

// ---------- Cài đặt chạy ----------
const DEFAULT_OUTPUT = () => path.join(app.getPath('videos'), 'MuseBatchStudio');
function outDir() {
  const dir = config.get().outputDir || DEFAULT_OUTPUT();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.warn('[Main] Không tạo được thư mục lưu:', e.message); }
  return dir;
}
const clampInt = (v, lo, hi, def) => Math.min(Math.max(parseInt(v, 10) || def, lo), hi);
function runConfig() {
  const c = config.get();
  return {
    outputDir: outDir(),
    maxAttempts: clampInt(c.maxAttempts, 1, 5, 2),
    limits: { image: clampInt(c.imageTimeoutMin, 1, 60, 5), video: clampInt(c.videoTimeoutMin, 5, 120, 30) }
  };
}

// ---------- Cửa sổ ----------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 1000,
    minHeight: 680,
    title: 'MuseBatch Studio',
    backgroundColor: '#060b10',
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', vibrancy: 'under-window' }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#081017', symbolColor: '#00e5ff', height: 48 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendUI(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// ---------- Chrome / Muse theo tài khoản ----------
// Mở lười: chỉ mở Chrome khi cần. Tài khoản đã xoá → trang "đã xoá", mọi lệnh báo lỗi, không mở Chrome.
function pageFor(id) {
  if (!accountStore.get(id)) return Object.assign(new MusePage(null), { removed: true });
  if (!pages.has(id)) {
    const chrome = new Chrome({ profileDir: path.join(userDir(), 'profiles', id), url: MUSE_URL, resolveProxy: () => proxyFor(id) });
    pages.set(id, new MusePage(chrome));
  }
  return pages.get(id);
}

// Kho proxy dự phòng: tắt công tắc = kho trống
const poolText = () => (accountStore.settings.usePool ? accountStore.settings.proxies : '');
const proxyHealth = new Map(); // dòng proxy → { ok, ms, error, checkedAt }
const deadProxies = () => new Set([...proxyHealth].filter(([, h]) => !h.ok).map(([line]) => line));
async function testProxy(p) {
  const h = { ...(await checkProxy(p)), checkedAt: Date.now() };
  proxyHealth.set(p.line, h);
  pushStatus();
  return h;
}

// Mỗi lần mở Chrome của 1 tài khoản: chọn proxy (giữ cố định), thử nhanh; chết → đánh dấu, tự chọn cái khác
async function proxyFor(id) {
  for (;;) {
    const acc = accountStore.get(id);
    if (!acc) return null;
    const { proxy, auto } = pickProxy(acc, accountStore.list(), poolText(), deadProxies());
    if (auto !== acc.proxyAuto) accountStore.update(id, { proxyAuto: auto });
    if (!proxy) return null;
    const h = await testProxy(proxy);
    if (h.ok) return proxy;
    if (acc.proxy) throw new Error(`Proxy ${proxy.host}:${proxy.port} của ${acc.name} không dùng được: ${h.error}`);
  }
}

// Proxy của tài khoản phải đổi → đóng Chrome đang rảnh, lần dùng sau tự mở với proxy mới.
// Tài khoản đang chạy task thì để nguyên tới lần mở Chrome sau.
function reapplyProxies() {
  for (const [id, page] of pages) {
    const acc = accountStore.get(id);
    if (!acc || !page.chrome.proc || pool.busy(id) || logins.has(id)) continue;
    let want = null;
    try { want = pickProxy(acc, accountStore.list(), poolText(), deadProxies()).proxy; } catch {}
    if ((want?.line || '') !== (page.chrome.proxy?.line || '')) page.chrome.close().catch(() => {});
  }
}

// ---------- Trạng thái gửi giao diện ----------
function blockedReason() {
  const s = accountStore.settings;
  const now = Date.now();
  const on = accountStore.list().filter(a => a.enabled);
  if (!on.length) return 'Chưa bật tài khoản nào';
  if (on.some(a => usable(a, s, now))) return '';
  if (on.every(a => a.loggedIn === false)) return 'Chưa đăng nhập Muse';
  const until = Math.min(...on.map(a => pausedUntil(a, s, now)).filter(Boolean));
  return Number.isFinite(until) ? `Hết hạn mức tới ${new Date(until).toLocaleDateString('vi-VN')}` : 'Hết hạn mức';
}

function accountsView() {
  const running = {};
  for (const id of pool.running.values()) running[id] = (running[id] || 0) + 1;
  const settings = accountStore.settings;
  const now = Date.now();
  // Proxy Chrome đang mở thật sự dùng (host:port, không lộ mật khẩu)
  const proxyNow = id => { const c = pages.get(id)?.chrome; return c?.proc && c.proxy ? `${c.proxy.host}:${c.proxy.port}` : ''; };
  const proxyFixed = a => {
    if (!a.proxy || a.proxy === 'none') return null;
    const p = parseProxy(a.proxy);
    return { label: p.error ? '' : `${p.host}:${p.port}`, error: p.error || '', health: proxyHealth.get(p.line) || null };
  };
  const accounts = accountStore.list().map(a => ({ ...a, pausedUntil: pausedUntil(a, settings, now), proxyNow: proxyNow(a.id), proxyFixed: proxyFixed(a) }));
  const proxies = parseList(poolText()).map(p => ({ line: p.line, label: p.error ? p.line : `${p.host}:${p.port}`, error: p.error || '', health: proxyHealth.get(p.line) || null }));
  return { accounts, settings, running, proxies, blocked: blockedReason(), now };
}

let pushQueued = false;
function pushStatus() {
  if (pushQueued || !pool) return;
  pushQueued = true;
  setImmediate(() => {
    pushQueued = false;
    const view = accountsView();
    const isConnected = view.accounts.some(a => a.enabled && a.loggedIn);
    sendUI('status-update', { isConnected });
    sendUI('accounts-update', view);
    crmServer?.updateStatus({
      isConnected,
      accounts: view.accounts.map(({ id, name, enabled, loggedIn, quota }) => ({ id, name, enabled, loggedIn, quota, running: view.running[id] || 0 }))
    });
  });
}

// ---------- Đăng nhập ----------
const logins = new Map(); // accountId → promise
function loginAccount(id) {
  if (logins.has(id)) { pageFor(id).show().catch(() => {}); return logins.get(id); }
  const job = (async () => {
    try {
      const ok = await ensureLogin(pageFor(id));
      if (accountStore.get(id)) accountStore.update(id, { loggedIn: ok });
      if (ok) {
        await pageFor(id).hide().catch(() => {});
        await pool.refreshQuota(id);
        pool.pump();
      }
      return ok;
    } catch (e) {
      console.warn('[Main] Chrome lỗi:', e.message);
      if (accountStore.get(id)) accountStore.update(id, { loggedIn: false });
      return false;
    } finally {
      logins.delete(id);
    }
  })();
  logins.set(id, job);
  return job;
}

// Mở app: dò ngầm từng tài khoản. Chỉ có 1 tài khoản mà chưa đăng nhập → hiện Chrome để đăng nhập luôn.
// Nhiều tài khoản → TK chưa đăng nhập thì đóng Chrome ẩn của nó, chờ người dùng bấm Đăng nhập (không bật nhiều cửa sổ).
async function startAccounts() {
  const on = accountStore.list().filter(a => a.enabled);
  const single = accountStore.list().length === 1 && on.length === 1;
  await Promise.all(on.map(async a => {
    const ok = await pool.checkLogin(a.id);
    if (ok) await pool.refreshQuota(a.id);
    else if (single) await loginAccount(a.id);
    else if (!logins.has(a.id)) await pageFor(a.id).chrome?.close().catch(() => {});
  }));
  pool.pump();
}

// ---------- Video xong ----------
function handleVideoFinished(localPath, origin) {
  const item = { localPath, filename: path.basename(localPath), originalUrl: origin, timestamp: Date.now() };
  sendUI('video-completed', item);
  if (crmServer) crmServer.updateStatus({ completedVideos: [item, ...(crmServer.status.completedVideos || [])].slice(0, 200) });
}

// ---------- Ảnh gửi kèm ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
function fetchImageAsDataUrl(url, hops = 0) {
  if (!url) return Promise.resolve(null);
  if (url.startsWith('data:')) return Promise.resolve(url);
  if (hops > 5) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const client = url.startsWith('https') ? https : http;
      // CDN hay chặn request không có User-Agent; redirect có thể là đường dẫn tương đối
      client.get(url, { headers: { 'User-Agent': UA }, timeout: 20000 }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchImageAsDataUrl(new URL(res.headers.location, url).href, hops + 1).then(resolve);
          return;
        }
        const type = res.headers['content-type'] || 'image/jpeg';
        if (res.statusCode !== 200 || type.includes('text/html')) { res.resume(); resolve(null); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(`data:${type.split(';')[0]};base64,${Buffer.concat(chunks).toString('base64')}`));
        res.on('error', () => resolve(null));
      }).on('timeout', function () { this.destroy(new Error('timeout')); }).on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

const MIME_BY_EXT = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.heic': 'image/heic' };
// Ảnh → { mimeType, dataBase64 }. Ảnh hỏng → lỗi, không lặng lẽ gửi prompt chỉ có chữ.
async function loadImage(img) {
  if (img.imageLocalPath && fs.existsSync(img.imageLocalPath)) {
    const mimeType = MIME_BY_EXT[path.extname(img.imageLocalPath).toLowerCase()] || 'image/jpeg';
    return { mimeType, dataBase64: fs.readFileSync(img.imageLocalPath).toString('base64') };
  }
  const m = img.imageUrl && /^data:([^;]+);base64,(.*)$/s.exec((await fetchImageAsDataUrl(img.imageUrl)) || '');
  if (!m) throw new Error('Không tải được ảnh: ' + (img.imageLocalPath || img.imageUrl || '(ảnh)'));
  return { mimeType: m[1], dataBase64: m[2] };
}

// ---------- Task ----------
const pump = () => setImmediate(() => pool.pump());

// Task vào dự án đang mở (API/CRM cũng vậy), trừ khi chỉ rõ dự án có thật
function submitTask(input) {
  const st = studioStore.get();
  const project = st.projects.some(p => p.id === input.project) ? input.project : st.current;
  const task = taskStore.add({ ...input, project });
  pump();
  return task;
}
const cancelTask = id => pool.cancel(id);
function retryTask(id) {
  const task = taskStore.get(id);
  if (!task || task.status === 'queued' || task.status === 'processing') return task || null;
  taskStore.update(id, { status: 'queued', step: '', error: '', files: [], progress: 0, startedAt: 0, finishedAt: 0, sessionId: '', accountId: '', attempts: 0, held: false });
  pump();
  return task;
}
function removeTask(id) {
  cancelTask(id);
  return taskStore.remove(id);
}

// API key v1: tạo 1 lần, lưu trong user_config.json
function apiKey(regenerate = false) {
  let key = config.get().apiKey;
  if (!key || regenerate) {
    key = 'msk_' + crypto.randomBytes(20).toString('hex');
    config.save({ apiKey: key });
  }
  return key;
}

// ---------- ffmpeg ----------
function bin(name) {
  const exe = IS_MAC ? name : name + '.exe';
  const dirs = [path.join(process.resourcesPath || '', 'bin'), path.join(__dirname, '..', 'resources', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map(d => path.join(d, exe)).find(p => fs.existsSync(p)) || '';
}
const NO_FFMPEG = IS_MAC ? 'Chưa cài ffmpeg. Chạy: brew install ffmpeg' : 'Thiếu ffmpeg.exe/ffprobe.exe trong thư mục resources\\bin — chép lại từ bộ cài';
const musicDir = () => { const d = path.join(outDir(), 'Nhạc nền'); fs.mkdirSync(d, { recursive: true }); return d; };

// =========================================================================
// VÒNG ĐỜI APP
// =========================================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  try { powerSaveBlocker.start('prevent-app-suspension'); } catch {}

  config = new Config(userDir());
  taskStore = new TaskStore(userDir());
  accountStore = new AccountStore(userDir());
  studioStore = new StudioStore(userDir());
  pool = new Pool({
    tasks: taskStore, accounts: accountStore, pageFor, config: runConfig, loadImage,
    skip: t => studioStore.pausedProjects().has(t.project || 'default'),
    onFiles: files => { for (const f of files) if (f.endsWith('.mp4')) handleVideoFinished(f, 'muse'); }
  });

  studioStore.on('update', data => sendUI('studio-update', data));
  taskStore.on('update', task => {
    sendUI('task-update', { task, blocked: blockedReason() });
    pushStatus();
  });
  accountStore.on('change', pushStatus);

  createMainWindow();
  startAccounts().catch(e => console.error('[Main] Khởi động tài khoản lỗi:', e));
  setInterval(() => { pool.pump(); pushStatus(); }, 60e3); // bắt lúc hạn mức đặt lại

  crmServer = new CrmServer(API_PORT, {
    onJobReceived: job => {
      sendUI('crm-job-received', job);
      return submitTask({ prompt: String(job.prompt), source: 'crm', label: job.topicId || '' });
    },
    apiKey: () => apiKey(),
    tasks: {
      list: status => taskStore.list(status),
      get: id => taskStore.get(id),
      submit: input => submitTask({ ...input, source: 'api' }),
      cancel: cancelTask,
      retry: retryTask,
      remove: removeTask
    }
  });
  crmServer.start();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('before-quit', () => {
  taskStore?.flush();
  accountStore?.flush();
  for (const page of pages.values()) page.chrome?.close().catch(() => {});
});

app.on('window-all-closed', () => {
  crmServer?.stop();
  if (!IS_MAC) app.quit();
});

// =========================================================================
// IPC
// =========================================================================
const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

// ---------- Tài khoản ----------
const ACCOUNT_FIELDS = ['name', 'enabled', 'threads', 'proxy'];
handle('accounts-list', () => accountsView());
handle('account-add', name => {
  const acc = accountStore.add(name);
  loginAccount(acc.id); // mở Chrome mới để đăng nhập luôn
  return acc;
});
handle('account-update', (id, patch = {}) => {
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => ACCOUNT_FIELDS.includes(k)));
  const acc = accountStore.update(id, clean);
  if ('proxy' in clean) reapplyProxies();
  if (acc?.enabled && acc.loggedIn === null) pool.checkLogin(id).then(ok => ok && pool.refreshQuota(id)).finally(pump);
  pump();
  return acc;
});
handle('account-remove', async id => {
  if (!accountStore.get(id)) return { ok: false, error: 'Không có tài khoản này' };
  if (accountStore.list().length <= 1) return { ok: false, error: 'Phải còn ít nhất 1 tài khoản' };
  if (pool.busy(id)) return { ok: false, error: 'Tài khoản đang chạy task. Dừng task trước rồi xoá.' };
  pool.releaseAccount(id);
  accountStore.remove(id);
  const page = pages.get(id);
  pages.delete(id);
  if (page) { page.removed = true; await page.chrome.close().catch(() => {}); }
  // Profile Chrome vào Thùng rác (lấy lại được nếu xoá nhầm)
  const dir = path.join(userDir(), 'profiles', id);
  if (fs.existsSync(dir)) await shell.trashItem(dir).catch(e => console.warn('[Main] Không bỏ được profile vào Thùng rác:', e.message));
  pump();
  return { ok: true };
});
handle('account-login', id => { loginAccount(id); return true; });
handle('account-show', id => pageFor(id).show().then(() => true, () => false));
handle('account-logout', async id => {
  if (pool.busy(id)) return { ok: false, error: 'Tài khoản đang chạy task. Dừng task trước.' };
  try { await pageFor(id).logout(); } catch (e) { return { ok: false, error: e.message }; }
  accountStore.update(id, { loggedIn: false });
  return { ok: true };
});
handle('accounts-settings', (patch = {}) => {
  const s = accountStore.setSettings(patch || {});
  if ('proxies' in (patch || {}) || 'usePool' in (patch || {})) reapplyProxies();
  pump();
  return s;
});
handle('proxies-check', async () => {
  // Kho dự phòng + proxy riêng của từng tài khoản (bỏ trùng)
  const own = accountStore.list().filter(a => a.proxy && a.proxy !== 'none').map(a => parseProxy(a.proxy)).filter(p => !p.error);
  const all = [...new Map([...parseList(poolText()), ...own].map(p => [p.line, p])).values()];
  await Promise.all(all.map(testProxy));
  reapplyProxies();
  pump();
  return accountsView();
});
handle('accounts-check-quota', async id => {
  const ids = id ? [id] : accountStore.list().filter(a => a.enabled && a.loggedIn).map(a => a.id);
  await Promise.all(ids.map(i => pool.refreshQuota(i)));
  pump();
  return accountsView();
});
handle('accounts-check-login', async () => {
  await Promise.all(accountStore.list().filter(a => a.enabled).map(a => pool.checkLogin(a.id, 2)));
  pump();
  return accountsView();
});

// ---------- Task ----------
handle('task-submit', input => submitTask({ ...(input || {}), source: 'ui' }));
handle('task-list', () => ({ tasks: taskStore.list(), blocked: blockedReason() }));
handle('task-cancel', id => cancelTask(id));
handle('task-retry', id => retryTask(id));
handle('task-remove', id => removeTask(id));
handle('task-resume', () => { pump(); return true; });
// Chạy các task đã chọn: task "chỉ thêm vào hàng đợi" thì bỏ cờ giữ, task lỗi/huỷ/xong thì chạy lại
handle('task-run', (ids = []) => {
  for (const id of ids) {
    const t = taskStore.get(id);
    if (t?.status === 'queued' && t.held) taskStore.update(id, { held: false });
    else if (t && t.status !== 'queued' && t.status !== 'processing') retryTask(id);
  }
  pump();
  return true;
});
handle('task-stop-all', () => {
  taskStore.list().filter(t => t.status === 'queued' || t.status === 'processing').forEach(t => cancelTask(t.id));
  return true;
});
handle('task-clear-finished', () => {
  taskStore.list().filter(t => t.status !== 'queued' && t.status !== 'processing').forEach(t => taskStore.remove(t.id));
  return true;
});

// ---------- Hàng đợi video của tab Kịch bản (lưu ra file để tắt app không mất lô đang làm) ----------
const queueFile = () => path.join(userDir(), 'queue.json');
// Chưa có file → null; file hỏng → { error } để giao diện KHÔNG ghi đè
handle('queue-load', () => {
  if (!fs.existsSync(queueFile())) return null;
  try { return JSON.parse(fs.readFileSync(queueFile(), 'utf8')); } catch (e) { return { error: e.message }; }
});
handle('queue-save', data => {
  const tmp = queueFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, queueFile());
  return true;
});

// ---------- File / thư mục ----------
handle('open-output-folder', () => { shell.openPath(outDir()); return true; });
handle('reveal-file', p => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); return true; });
handle('open-external', url => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) { shell.openExternal(url); return true; }
  return false;
});
handle('select-image-file', async (multi = false) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn ảnh',
    filters: [{ name: 'Ảnh (*.jpg, *.png, *.webp, *.jpeg, *.heic, *.bmp)', extensions: ['jpg', 'png', 'webp', 'jpeg', 'heic', 'bmp'] }],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
  });
  if (r.canceled || !r.filePaths?.length) return multi ? [] : null;
  const files = r.filePaths.map(filePath => {
    const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/jpeg';
    return { filePath, filename: path.basename(filePath), dataUrl: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` };
  });
  return multi ? files : files[0];
});
handle('select-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: outDir() });
  return r.canceled ? null : r.filePaths[0];
});
handle('fetch-image-base64', url => fetchImageAsDataUrl(url));

// Thư viện: video trong thư mục lưu + ảnh trong storyboard/, mới nhất trước
handle('list-library', () => {
  const read = (dir, re, kind) => {
    try {
      return fs.readdirSync(dir).filter(f => re.test(f)).map(filename => {
        const localPath = path.join(dir, filename);
        const st = fs.statSync(localPath);
        return { kind, filename, localPath, timestamp: st.mtimeMs, size: st.size };
      });
    } catch { return []; }
  };
  return [...read(outDir(), /\.(mp4|mov|webm|m4v)$/i, 'video'), ...read(path.join(outDir(), 'storyboard'), /\.(png|jpe?g|webp)$/i, 'image')]
    .sort((a, b) => b.timestamp - a.timestamp);
});
// Bỏ vào Thùng rác — chỉ file nằm trong thư mục lưu
handle('trash-files', async (paths = []) => {
  const root = path.resolve(outDir()) + path.sep;
  let n = 0;
  for (const p of paths) {
    if (typeof p !== 'string' || !path.resolve(p).startsWith(root)) continue;
    await shell.trashItem(p).then(() => n++, e => console.warn('[Main] Không xoá được', p, e.message));
  }
  return n;
});

// ---------- Ghép video & nhạc nền ----------
handle('merge-videos', async (paths = [], name = '') => {
  const ffmpeg = bin('ffmpeg');
  if (!ffmpeg) return { success: false, error: NO_FFMPEG };
  const files = (paths || []).filter(p => typeof p === 'string' && fs.existsSync(p));
  if (files.length < 2) return { success: false, error: 'Cần ít nhất 2 video' };
  const r = await merger.merge({
    ffmpeg, ffprobe: bin('ffprobe'), files, out: merger.safeName(outDir(), name), tmpDir: app.getPath('temp'),
    onProgress: pct => sendUI('merge-progress', pct)
  });
  if (r.success) handleVideoFinished(r.path, 'merged');
  return r;
});
handle('open-music-folder', () => { shell.openPath(musicDir()); return merger.musicFiles(musicDir()).length; });
handle('add-music', async video => {
  const ffmpeg = bin('ffmpeg');
  const ffprobe = bin('ffprobe');
  if (!ffmpeg || !ffprobe) return { success: false, error: NO_FFMPEG };
  if (typeof video !== 'string' || !fs.existsSync(video)) return { success: false, error: 'Không thấy file video' };
  const songs = merger.musicFiles(musicDir());
  if (!songs.length) return { success: false, error: 'Thư mục "Nhạc nền" chưa có bài nào (mp3/m4a/wav). Bỏ nhạc vào rồi bấm "Thử lại".' };
  const music = songs[Math.floor(Math.random() * songs.length)];
  const out = merger.safeName(path.dirname(video), path.basename(video, path.extname(video)) + ' - nhạc nền');
  const r = await merger.addMusic({ ffmpeg, ffprobe, video, music, out });
  if (r.success) handleVideoFinished(r.path, 'music');
  return r;
});

// ---------- Tư liệu & dự án ----------
handle('studio-get', () => studioStore.get());
handle('studio-save', (patch = {}) => {
  const { characters, templates, model, rotate } = patch || {};
  return studioStore.save(Object.fromEntries(Object.entries({ characters, templates, model, rotate }).filter(([, v]) => v !== undefined)));
});
handle('studio-add-image', src => studioStore.addImage(src || {}));
handle('project-add', name => studioStore.addProject(name));
handle('project-update', (id, patch) => { studioStore.updateProject(id, patch || {}); pump(); return studioStore.get(); });
handle('project-current', id => { studioStore.setCurrent(id); return studioStore.get(); });
// Xoá dự án: huỷ + xoá task của nó (file đã tải giữ nguyên)
handle('project-remove', id => {
  if (!studioStore.removeProject(id)) return false;
  taskStore.list().filter(t => t.project === id).forEach(t => removeTask(t.id));
  return true;
});

// ---------- LadiPage ----------
// Giữ trang vừa quét để đổi tuỳ chọn (không đọc giá, thời lượng) thì sinh lại ngay, không quét lại
let lastLadi = null;
handle('scrape-and-analyze-ladi', async (url, opts = {}) => {
  try {
    const raw = opts.reuse && lastLadi && lastLadi.url === url ? lastLadi.raw : await scrapeLadiPage(url);
    lastLadi = { url, raw };
    return { success: true, data: generateScriptsFromProduct(raw, opts) };
  } catch (err) {
    console.error('[Main] Lỗi phân tích LadiPage:', err);
    return { success: false, error: err.message };
  }
});

// ---------- Cài đặt & API ----------
const SETTING_KEYS = ['outputDir', 'maxAttempts', 'imageTimeoutMin', 'videoTimeoutMin'];
handle('get-settings', () => ({ ...runConfig(), ...Object.fromEntries(SETTING_KEYS.map(k => [k, config.get()[k]])), outputDir: outDir() }));
handle('save-settings', (patch = {}) => {
  config.save(Object.fromEntries(Object.entries(patch || {}).filter(([k]) => SETTING_KEYS.includes(k))));
  return { ...runConfig(), ...Object.fromEntries(SETTING_KEYS.map(k => [k, config.get()[k]])), outputDir: outDir() };
});
handle('get-api-key', regenerate => apiKey(Boolean(regenerate)));
handle('get-app-config', () => ({ outputDir: outDir(), version: VERSION, apiEndpoint: `http://127.0.0.1:${API_PORT}` }));
