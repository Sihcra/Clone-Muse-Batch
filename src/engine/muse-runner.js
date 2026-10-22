'use strict';
/**
 * MUSE RUNNER — chạy 1 task trên 1 trang Muse: gửi lệnh → lưu sessionId → dò phiên → tải file kết quả.
 * Không phụ thuộc Electron: page, đồng hồ, sleep, cách đọc ảnh đều truyền vào (test bằng page giả).
 */

const fs = require('fs');
const path = require('path');

const RATIO_LABEL = { '9:16': '9:16 dọc', '16:9': '16:9 ngang', '1:1': '1:1 vuông', '4:3': '4:3 ngang', '3:4': '3:4 dọc' };
const MAX_ATTACH_BYTES = 8 * 1024 * 1024; // Muse giới hạn tổng ảnh gửi kèm 8MB
const MAX_POLL_ERRORS = 5; // dò lỗi liên tiếp quá chừng này thì bỏ cuộc
const EXT = { 'video/mp4': 'mp4', 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
const realSleep = ms => new Promise(r => setTimeout(r, ms));
const extOf = mime => EXT[mime] || String(mime).split('/')[1] || 'bin';

// Lỗi do Muse trả lời (không ra file, quá giờ) — khác lỗi đường truyền: chỉ thử lại bằng chat mới mới có ích
const museError = msg => Object.assign(new Error(msg), { museResult: true });

function buildMessage({ kind, ratio, prompt }) {
  const head = (kind === 'image' ? 'Tạo ảnh' : 'Tạo video') + (RATIO_LABEL[ratio] ? ` · tỷ lệ ${RATIO_LABEL[ratio]}` : '');
  return `${head}\n${prompt}`;
}

// Chưa đăng nhập → hiện Chrome cho người dùng đăng nhập, xong thì ẩn. Hết giờ → false (Chrome vẫn mở).
// Người dùng tự đóng Chrome = bỏ đăng nhập → dừng, không mở lại.
async function ensureLogin(page, { sleep = realSleep, now = Date.now, waitMs = 15 * 60e3, pollMs = 5000 } = {}) {
  const loggedIn = async () => Boolean((await page.login().catch(() => null))?.loggedIn);
  if (await loggedIn()) return true;
  await page.show();
  const start = now();
  while (now() - start < waitMs && !page.removed && page.chrome?.running !== false) {
    await sleep(pollMs);
    if (await loggedIn()) {
      await page.hide();
      return true;
    }
  }
  return false;
}

/**
 * Chạy task. Trả mảng đường dẫn file đã lưu; null nếu task bị huỷ giữa chừng; throw khi lỗi.
 * task.sessionId có sẵn (đã gửi trước đó, vd. app tắt giữa chừng) → không gửi lại, chỉ dò tiếp.
 */
async function runTask(task, {
  page, accountId = '', update, isLive, outputDir, loadImage,
  limits = { image: 5, video: 30 }, sleep = realSleep, now = Date.now, pollMs = 4000
}) {
  const what = task.kind === 'image' ? 'ảnh' : 'video';
  let sid = task.sessionId;
  let inThread = false;

  if (!sid) {
    const atts = [];
    for (const [k, img] of (task.images || []).entries()) {
      const { mimeType, dataBase64 } = await loadImage(img);
      atts.push({ filename: `anh_${k + 1}.${extOf(mimeType)}`, mimeType, dataBase64, category: 'image' });
    }
    const bytes = atts.reduce((n, a) => n + Buffer.byteLength(a.dataBase64, 'base64'), 0);
    if (bytes > MAX_ATTACH_BYTES) throw new Error('Ảnh gửi kèm quá 8MB (giới hạn của Muse). Bớt ảnh hoặc dùng ảnh nhỏ hơn.');

    update({ step: 'Gửi lệnh', progress: 10 });
    // Có chat cũ (vd. chat vừa vẽ storyboard) và đúng tài khoản giữ chat đó → gửi tiếp vào đó.
    // Vẫn gắn ảnh: lỡ vào chat khác thì Muse vẫn đủ ảnh.
    const thread = task.thread && (!task.pin || task.pin === accountId) ? task.thread.split('/').pop() : '';
    let sent = null;
    if (thread) {
      sent = await page.send(buildMessage(task), atts, thread).catch(e => ({ ok: false, reason: e.message }));
      inThread = Boolean(sent?.ok && sent.sessionId);
      if (!inThread) update({ threadError: `Không gửi được vào chat storyboard (${sent?.reason || 'không rõ lý do'}), làm ở chat mới` });
    }
    if (!inThread) sent = await page.send(buildMessage(task), atts);
    if (!sent?.ok || !sent.sessionId) throw new Error(`Muse không nhận lệnh: ${sent?.reason || 'không rõ lý do'}`);
    sid = sent.sessionId;
    update({ sessionId: sid, step: 'Muse đang xử lý', progress: 20 });
  }

  // Hạn tính từ lúc task bắt đầu → mở lại app vẫn giữ đúng hạn
  const limitMin = Math.max(limits[task.kind === 'image' ? 'image' : 'video'], task.timeoutMin || 0);
  // Gửi tiếp vào chat cũ: phiên đang "xong" từ lượt trước → phải thấy nó chạy lại (tối đa 30s) mới tính là xong
  let seenRunning = !inThread;
  const sentAt = now();
  const expectedMs = (task.kind === 'image' ? 25 : 100) * 1000;
  let status = null;
  for (let errors = 0; ;) {
    await sleep(pollMs);
    if (!isLive()) return null;
    try {
      status = await page.status(sid);
      errors = 0;
    } catch (e) {
      if (++errors >= MAX_POLL_ERRORS) throw e;
      status = 'running';
    }
    if (status === 'running') {
      seenRunning = true;
      const pct = Math.min(92, Math.round(20 + ((now() - sentAt) / expectedMs) * 72));
      update({ step: `Đang tạo ${pct}%`, progress: pct });
    } else if (seenRunning || now() - sentAt > 30e3) {
      break;
    } else {
      continue;
    }
    if (now() - (task.startedAt || sentAt) > limitMin * 60e3) {
      await page.cancel(sid).catch(() => {});
      throw museError(`Quá ${limitMin} phút Muse chưa làm xong.`);
    }
  }
  if (!isLive()) return null;

  update({ step: 'Đang tải kết quả (95%)', progress: 95 });
  const { files, text } = await page.result(sid);
  let wanted = files.filter(f => String(f.mime).startsWith(task.kind === 'image' ? 'image/' : 'video/'));
  if (task.kind === 'image') wanted = wanted.slice(0, task.expect || 1);
  if (!wanted.length) {
    throw museError(text ? `Muse không tạo ${what}. Muse trả lời: "${text}"` : `Muse không trả về ${what} (phiên ${status || 'không thấy'}).`);
  }

  update({ step: 'Tải file kết quả', progress: 96 });
  const dir = task.kind === 'image' ? path.join(outputDir, 'storyboard') : outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const [k, f] of wanted.entries()) {
    const buf = await page.readFile(f.path);
    if (f.byteLen && buf.length !== f.byteLen) throw new Error(`Tải file lỗi: ${buf.length}/${f.byteLen} byte`);
    const file = path.join(dir, `Muse_${now()}_${k + 1}.${extOf(f.mime)}`);
    fs.writeFileSync(file, buf);
    saved.push(file);
    const pct = Math.round(96 + ((k + 1) / wanted.length) * 3);
    update({ step: `Tải file (${pct}%)`, progress: pct });
  }
  return saved;
}

/**
 * Sau lỗi: task (bản mới nhất) → patch.
 * - Hết lượt thử → failed.
 * - Đã gửi (có sessionId) mà lỗi đường truyền → giữ phiên, dò lại, KHÔNG gửi lại (không tốn thêm lượt Muse).
 * - Còn lại → xếp hàng lại, gửi bằng chat mới.
 */
function failurePatch(task, e, now = Date.now(), maxAttempts = 2) {
  if (task.attempts >= maxAttempts) return { status: 'failed', error: e.message, finishedAt: now };
  if (task.sessionId && !e.museResult) return { attempts: task.attempts + 1, error: `Lỗi lần ${task.attempts}, đang dò lại phiên: ${e.message}` };
  return { status: 'queued', sessionId: '', error: `Lỗi lần ${task.attempts}, đang thử lại: ${e.message}` };
}

module.exports = { buildMessage, ensureLogin, runTask, failurePatch, RATIO_LABEL, MAX_ATTACH_BYTES };
