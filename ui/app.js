/**
 * Lõi giao diện: điều hướng tab, sáng/tối, toast, tiện ích dùng chung (window.App).
 * Mỗi tab là 1 file riêng gắn vào window.App. Đổi tab phát sự kiện 'app:tab' (detail = id tab).
 */
(function () {
  'use strict';

  const api = window.electronAPI;
  const $ = id => document.getElementById(id);

  const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // C:\a\b.mp4 → file:///C:/a/b.mp4 (giữ ổ đĩa, mã hoá từng đoạn còn lại)
  const fileUrl = p => {
    p = String(p);
    if (/^[A-Za-z]:\\/.test(p)) p = '/' + p.replace(/\\/g, '/');
    return 'file://' + p.split('/').map(s => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/');
  };
  const pad2 = n => String(n).padStart(2, '0');
  const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
  const fmtDate = ts => { if (!ts) return ''; const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; };
  const fmtTime = ts => (ts ? `${new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${fmtDate(ts)}` : '');
  const chip = (tone, text, title = '') => `<span class="st-chip" data-tone="${tone}"${title ? ` title="${escapeHtml(title)}"` : ''}><span class="st-dot"></span>${escapeHtml(text)}</span>`;

  // Thay alert(): thông báo góc dưới, tự tắt, bấm để tắt sớm. tone: info | ok | warn | danger
  function toast(msg, tone = 'info') {
    let box = $('ui-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ui-toasts';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.tone = tone;
    el.textContent = msg;
    el.addEventListener('click', () => el.remove());
    box.appendChild(el);
    setTimeout(() => el.remove(), tone === 'warn' || tone === 'danger' ? 9000 : 5000);
  }

  // Nhớ lựa chọn giữa các lần mở app; giá trị lưu không còn trong danh sách thì giữ mặc định
  function remember(el, key) {
    try {
      const v = localStorage.getItem('muse.' + key);
      if (v !== null) {
        if (el.type === 'checkbox') el.checked = v === '1';
        else if (el.tagName !== 'SELECT' || [...el.options].some(o => o.value === v)) el.value = v;
      }
    } catch (e) {}
    el.addEventListener('change', () => {
      try { localStorage.setItem('muse.' + key, el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value); } catch (e) {}
    });
  }

  // ---------- Điều hướng ----------
  const navItems = document.querySelectorAll('.nav-item');
  function goTab(tabId) {
    const item = document.querySelector(`.nav-item[data-tab="${tabId}"]`) || navItems[0];
    const id = item.dataset.tab;
    navItems.forEach(i => i.classList.toggle('active', i === item));
    document.querySelectorAll('.stage-view').forEach(v => v.classList.toggle('active', v.id === id));
    $('crumb-title').textContent = [...item.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    try { localStorage.setItem('muse.tab', id); } catch (e) {}
    document.dispatchEvent(new CustomEvent('app:tab', { detail: id }));
  }
  navItems.forEach(item => item.addEventListener('click', () => goTab(item.dataset.tab)));

  // ---------- Sáng / Tối ----------
  const btnTheme = $('btn-theme');
  const syncThemeBtn = () => { btnTheme.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'; };
  btnTheme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('muse.theme.v2', next); } catch (e) {}
    syncThemeBtn();
  });
  syncThemeBtn();

  // ---------- Nút chung trên thanh trên ----------
  $('btn-open-finder').addEventListener('click', () => api?.openOutputFolder());
  $('btn-resume').addEventListener('click', async () => { await api?.resumeTasks(); toast('Đã cho chạy tiếp hàng đợi.', 'ok'); });
  $('btn-stop-all').addEventListener('click', async () => {
    if (!confirm('Huỷ mọi task đang chờ và đang chạy?')) return;
    await api?.stopAllTasks();
    toast('Đã dừng tất cả task.', 'warn');
  });
  // Lý do task đang chờ không chạy được (chưa đăng nhập, hết hạn mức...)
  const setBlocked = text => {
    const el = $('top-blocked');
    el.hidden = !text;
    el.lastElementChild.textContent = text || '';
  };
  api?.onTaskUpdate(({ blocked }) => setBlocked(blocked));

  // Nút đóng hộp thoại dùng chung
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-close-dialog]');
    if (b) b.closest('dialog')?.close();
  });
  // Enter trong ô nhập của hộp thoại → bấm nút xác nhận chính (không phải nút Huỷ / nút ghost)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.target.tagName !== 'INPUT') return;
    const dlg = e.target.closest('dialog[open]');
    if (!dlg) return;
    const primary = dlg.querySelector('button.btn:not(.btn-ghost):not([data-close-dialog]):not(:disabled)');
    if (!primary) return;
    e.preventDefault();
    primary.click();
  });
  // Thả file ra ngoài vùng nhận thì Electron sẽ mở file thay cho app → chặn mặc định
  ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));

  window.App = { api, $, escapeHtml, sleep, fileUrl, mmss, fmtTime, fmtDate, chip, toast, remember, goTab, setBlocked };

  // Các file tab nạp sau app.js → chờ nạp xong mới mở tab đã nhớ để tab nhận được 'app:tab'
  window.addEventListener('DOMContentLoaded', () => {
    let saved = null;
    try { saved = localStorage.getItem('muse.tab'); } catch (e) {}
    goTab(saved || 'tab-studio');
  });
})();
