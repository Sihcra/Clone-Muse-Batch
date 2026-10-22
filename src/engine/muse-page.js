'use strict';
/**
 * MUSE PAGE — cầu nối nạp vào trang muse.ai (window.__mss) + lớp Node gọi nó qua Chrome (CDP).
 * Gửi lệnh bằng chính client chat React của Muse (sendMessage; mặc định mỗi lệnh 1 chat mới, hoặc gửi tiếp vào
 * 1 chat có sẵn), đọc phiên qua RPC nội bộ của Muse (sessions.list / chat.history / chat.cancel),
 * tải file qua fs.raw theo từng đoạn base64 2MB.
 */

const CHUNK = 2 * 1024 * 1024;

// Hàm này chạy TRONG trang Muse, không chạy trong Node — được chuyển thành chuỗi bằng toString().
function bridge(CHUNK) {
  const runtime = () => window.__hatchEarlyGatewayRuntimeState.activeRuntime.getSnapshot();

  // Client chat của Muse = memoizedProps.value có cả sendMessage lẫn ensureActiveChatSendReady.
  // Duyệt cây Fiber bằng stack (child + sibling) từ gốc React; không dựa vào class CSS (đổi theo mỗi bản build).
  const findChat = () => {
    if (!document.body) return null; // vừa chuyển trang, trang mới chưa dựng
    let root = null;
    const els = [document.body, ...document.querySelectorAll('body *')].slice(0, 80);
    for (const el of els) {
      const key = Object.keys(el).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
      if (key) { root = el[key]; break; }
    }
    if (!root) return null;
    if (root.stateNode && root.stateNode.current) root = root.stateNode.current;
    const stack = [root];
    for (let n = 0; stack.length && n < 300000; n++) {
      const f = stack.pop();
      const v = f.memoizedProps && f.memoizedProps.value;
      if (v && typeof v.sendMessage === 'function' && typeof v.ensureActiveChatSendReady === 'function') return v;
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    return null;
  };

  const blobs = new Map();
  let blobSeq = 0;
  const toBase64 = u8 => {
    let s = '';
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return btoa(s);
  };

  window.__mss = {
    async login() {
      try {
        const r = await fetch('/api/session', { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        return { loggedIn: r.status === 200 && Boolean(findChat()), http: r.status, status: j.status || null, vm: j.vm_state || null };
      } catch (e) {
        return { loggedIn: false, http: 0, status: null, vm: null };
      }
    },

    // thread = sessionId của 1 chat có sẵn → gửi thẳng vào chat đó (targetRoute), không chuyển trang.
    // Không có thread → Muse mở chat mới (createNewThread).
    async send(text, attachments, thread) {
      let chat = findChat();
      // Trang đang chuyển/dựng lại → chờ tối đa 20s cho client chat xuất hiện lại
      for (let i = 0; !chat && i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        chat = findChat();
      }
      if (!chat) return { ok: false, sessionId: '', reason: `not_ready (${location.pathname})` };
      const opts = thread
        ? { targetRoute: { kind: 'thread', sessionId: thread }, waitForReadiness: true }
        : { createNewThread: true, waitForReadiness: true };
      const r = await chat.sendMessage(text, attachments, opts);
      const ok = Boolean(r && r.ok);
      return { ok, sessionId: (r && r.sessionId) || (ok ? thread || '' : ''), reason: (r && (r.reason || r.error)) || '' };
    },

    async status(sid) {
      const { sessions = [] } = await runtime().sendRequest('sessions.list', {});
      const s = sessions.find(x => x.session_id === sid);
      return s ? s.status : null;
    },

    async result(sid) {
      const h = await runtime().sendRequest('chat.history', { session_id: sid, limit: 50 });
      return (h.chat_events || []).filter(e => e.role === 'assistant').map(e => {
        const data = (e.payload && e.payload.data) || {};
        return { text: e.display_text || '', images: data.images || [], videos: data.videos || [] };
      });
    },

    async open(path) {
      const r = await runtime().sendRequest('fs.raw', { path: path.replace(/^sandbox:\/\//, '') });
      const blob = r instanceof Blob ? r : r.data;
      blobs.set(++blobSeq, blob);
      return { id: blobSeq, size: blob.size };
    },

    async slice(id, i) {
      const part = blobs.get(id).slice(i * CHUNK, (i + 1) * CHUNK);
      return toBase64(new Uint8Array(await part.arrayBuffer()));
    },

    closeFile(id) {
      blobs.delete(id);
      return null;
    },

    async cancel(sid) {
      await runtime().sendRequest('chat.cancel', { session_id: sid });
      return null;
    },

    // Hạn mức: Next.js server action "fetchSubscriptionAction". Id của action đổi theo mỗi bản Muse → dò trong
    // các file JS trang đã tải. Chưa tìm được (trang chưa từng hiện) → null = chưa rõ hạn mức.
    async quota() {
      if (!window.__mssQuotaId) {
        const re = /createServerReference\)\("([0-9a-f]{20,})",[^;]{0,120}?"fetchSubscriptionAction"\)/;
        const scripts = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(u => /\.js(\?|$)/.test(u)))];
        for (const u of scripts) {
          const src = await fetch(u).then(r => r.text()).catch(() => '');
          const m = re.exec(src);
          if (m) { window.__mssQuotaId = m[1]; break; }
        }
        if (!window.__mssQuotaId) return null;
      }
      const r = await fetch('/', {
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify([{}]),
        headers: { 'Next-Action': window.__mssQuotaId, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' }
      });
      if (!r.ok) { window.__mssQuotaId = ''; return null; }
      for (const line of (await r.text()).split('\n')) {
        if (!line.includes('"success"')) continue;
        try {
          const j = JSON.parse(line.slice(line.indexOf(':') + 1));
          if (j.success && j.subscription) return j.subscription;
        } catch (e) {}
      }
      return null;
    }
  };
  return window.__mss;
}

const BRIDGE = `(${bridge.toString()})(${CHUNK})`;

// Sự kiện assistant [{text, images, videos}] → { files: [{path, mime, byteLen}], text }. Video trước ảnh, bỏ file missing.
function parseResult(events) {
  const pick = list => list.filter(m => m && !m.missing).map(m => ({ path: m.path, mime: m.mime, byteLen: m.byte_len }));
  return {
    files: [...pick(events.flatMap(e => e.videos || [])), ...pick(events.flatMap(e => e.images || []))],
    text: events.map(e => e.text).filter(Boolean).join('\n')
  };
}

// subscription của Muse → số liệu hạn mức gọn cho app
function parseQuota(sub) {
  if (!sub || !sub.usage) return null;
  const total = Number(sub.topupTotal) || 0;
  const balance = Number(sub.topupBalance) || 0;
  return {
    pct: Number(sub.usage.percentUsed) || 0,
    resetsAt: (Number(sub.usage.resetsAt) || 0) * 1000,
    status: sub.usage.quotaStatus || '',
    tier: (sub.tier && sub.tier.name) || '',
    paid: Boolean(sub.tier && sub.tier.isPaid),
    topupLeft: total > 0 ? balance / total : null,
    topupBalance: balance,
    topupTotal: total,
    label: sub.usageRowValueLabel || '',
    subtitle: sub.statusSubtitle || '',
    checkedAt: Date.now()
  };
}

class MusePage {
  constructor(chrome) {
    this.chrome = chrome;
    this.removed = false;
  }

  // Tài khoản đã xoá → không bao giờ mở lại Chrome (vòng dò cũ còn chạy sẽ mở Chrome mồ côi)
  async ready() {
    if (this.removed) throw new Error('Tài khoản đã bị xoá');
    if (!this.chrome.running) await this.chrome.start();
  }

  async call(name, ...args) {
    await this.ready();
    // send chờ Muse chuẩn bị máy (waitForReadiness) → cho tới 3 phút
    const expr = `(window.__mss || ${BRIDGE})[${JSON.stringify(name)}](...${JSON.stringify(args)})`;
    return this.chrome.evaluate(expr, name === 'send' ? 180e3 : undefined);
  }

  login() { return this.call('login'); }

  // Không thấy client chat (trang lạ/kẹt) → về trang chủ Muse rồi gửi lại 1 lần
  async send(text, attachments, thread = '') {
    const r = await this.call('send', text, attachments, thread);
    if (!/^not_ready/.test((r && r.reason) || '')) return r;
    await this.chrome.cmd('Page.navigate', { url: this.chrome.url }, this.chrome.sessionId);
    return this.call('send', text, attachments, thread);
  }

  status(sid) { return this.call('status', sid); }
  async result(sid) { return parseResult(await this.call('result', sid)); }
  cancel(sid) { return this.call('cancel', sid); }
  async quota() { return parseQuota(await this.call('quota')); }

  async readFile(path) {
    const { id, size } = await this.call('open', path);
    try {
      const parts = [];
      for (let i = 0; i * CHUNK < size; i++) parts.push(Buffer.from(await this.call('slice', id, i), 'base64'));
      return Buffer.concat(parts);
    } finally {
      await this.call('closeFile', id).catch(() => {});
    }
  }

  async show() { await this.ready(); await this.chrome.show(); }
  async hide() { if (this.chrome && this.chrome.running) await this.chrome.hide(); }
  async logout() { await this.ready(); await this.chrome.clearSiteData('https://muse.ai'); }
}

module.exports = { MusePage, parseResult, parseQuota, BRIDGE, CHUNK };
