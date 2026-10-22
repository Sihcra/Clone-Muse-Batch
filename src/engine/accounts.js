'use strict';
/**
 * ACCOUNT STORE — các tài khoản Muse + cài đặt chạy song song, lưu ở userData/accounts.json.
 * Mỗi tài khoản 1 Chrome riêng với profile userData/profiles/<id>. Luôn còn ít nhất 1 tài khoản.
 */

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { writeJsonAtomic } = require('./fs-util');

const DEFAULT_SETTINGS = { maxAccounts: 2, totalThreads: 2, mode: 'rotate', useTopup: true, keepGoing: false, proxies: '', usePool: false };
const clamp = (v, lo, hi, def) => Math.min(Math.max(parseInt(v, 10) || def, lo), hi);

function cleanSettings(s = {}) {
  return {
    maxAccounts: clamp(s.maxAccounts ?? DEFAULT_SETTINGS.maxAccounts, 1, 20, 1),
    totalThreads: clamp(s.totalThreads ?? DEFAULT_SETTINGS.totalThreads, 1, 50, 1),
    mode: s.mode === 'sequential' ? 'sequential' : 'rotate',
    useTopup: s.useTopup ?? DEFAULT_SETTINGS.useTopup,
    keepGoing: s.keepGoing ?? DEFAULT_SETTINGS.keepGoing,
    proxies: String(s.proxies ?? '').slice(0, 20000), // mỗi dòng 1 proxy, xem proxy.js
    // Công tắc kho proxy dự phòng; dữ liệu cũ đã có danh sách → coi như bật
    usePool: Boolean(s.usePool ?? String(s.proxies ?? '').trim())
  };
}

function cleanAccount(a) {
  return {
    id: a.id,
    name: String(a.name || a.id).slice(0, 60),
    enabled: a.enabled !== false,
    threads: clamp(a.threads ?? 1, 1, 5, 1),
    loggedIn: a.loggedIn ?? null, // null = chưa kiểm tra
    quota: a.quota || null,
    lastUsedAt: a.lastUsedAt || 0,
    // proxy: '' = tự lấy từ kho, 'none' = không dùng, còn lại = 1 dòng proxy cố định
    // proxyAuto: proxy đang được tự chọn cho tài khoản này (giữ cố định tới khi chết)
    proxy: String(a.proxy || '').slice(0, 300),
    proxyAuto: String(a.proxyAuto || '').slice(0, 300)
  };
}

class AccountStore extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'accounts.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch {}
    this.settings = cleanSettings(data.settings);
    this.accounts = (Array.isArray(data.accounts) ? data.accounts : [])
      .filter(a => a && typeof a.id === 'string' && a.id)
      .map(cleanAccount);
    if (!this.accounts.length) this.accounts = [cleanAccount({ id: 'default', name: 'Tài khoản 1' })];
  }

  changed() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
    this.emit('change');
  }

  flush() {
    clearTimeout(this.saveTimer);
    try {
      writeJsonAtomic(this.file, { settings: this.settings, accounts: this.accounts }, 1);
    } catch (e) {
      console.error('[AccountStore] Không ghi được accounts.json:', e.message);
    }
  }

  list() { return this.accounts; }
  get(id) { return this.accounts.find(a => a.id === id); }

  add(name) {
    const acc = cleanAccount({
      id: 'acc_' + crypto.randomBytes(4).toString('hex'),
      name: String(name || '').trim() || `Tài khoản ${this.accounts.length + 1}`
    });
    this.accounts.push(acc);
    this.changed();
    return acc;
  }

  update(id, patch) {
    const i = this.accounts.findIndex(a => a.id === id);
    if (i < 0) return null;
    this.accounts[i] = cleanAccount({ ...this.accounts[i], ...patch, id });
    this.changed();
    return this.accounts[i];
  }

  remove(id) {
    if (this.accounts.length <= 1 || !this.get(id)) return false;
    this.accounts = this.accounts.filter(a => a.id !== id);
    this.changed();
    return true;
  }

  setSettings(patch) {
    this.settings = cleanSettings({ ...this.settings, ...patch });
    this.changed();
    return this.settings;
  }
}

module.exports = { AccountStore, DEFAULT_SETTINGS, cleanSettings, cleanAccount };
