'use strict'
// accounts.js — Multi-account credentials, proxies & settings store
// Repository pattern: atomic writes, guarantees default account presence

const fs = require('node:fs')
const path = require('node:path')
const { DEFAULT_ACCOUNT_ID, DEFAULT_SETTINGS } = require('./constants')

class AccountStore {
  /** @param {string} userDataDir */
  constructor(userDataDir) {
    this._dir = userDataDir
    this._accFile = path.join(userDataDir, 'accounts.json')
    this._setFile = path.join(userDataDir, 'settings.json')
    fs.mkdirSync(userDataDir, { recursive: true })

    this._accounts = this._loadAccounts()
    this._settings = this._loadSettings()
  }

  // ── Accounts ──────────────────────────────────────────────────────────────

  getAccounts() {
    return [...this._accounts]
  }

  getAccount(id) {
    return this._accounts.find(a => a.id === id) ?? null
  }

  saveAccount(acc) {
    if (!acc.id) throw new Error('Account id is required')
    const existingIdx = this._accounts.findIndex(a => a.id === acc.id)
    if (existingIdx >= 0) {
      this._accounts[existingIdx] = { ...this._accounts[existingIdx], ...acc }
    } else {
      this._accounts.push({
        id: acc.id,
        name: acc.name ?? acc.id,
        enabled: acc.enabled ?? true,
        threads: acc.threads ?? 1,
        loggedIn: acc.loggedIn ?? false,
        quota: acc.quota ?? { weekly: 0, used: 0, resetAt: 0 },
        lastUsedAt: acc.lastUsedAt ?? 0,
        proxy: acc.proxy ?? '',
        proxyAuto: acc.proxyAuto ?? false,
      })
    }
    this._saveAccounts()
    return this.getAccount(acc.id)
  }

  updateAccount(id, patch) {
    let updated = null
    this._accounts = this._accounts.map(a => {
      if (a.id !== id) return a
      updated = { ...a, ...patch }
      return updated
    })
    if (!updated) throw new Error(`Account not found: ${id}`)
    this._saveAccounts()
    return updated
  }

  deleteAccount(id) {
    if (this._accounts.length <= 1) {
      throw new Error('Cannot delete the last remaining account')
    }
    this._accounts = this._accounts.filter(a => a.id !== id)
    this._saveAccounts()
    return true
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  getSettings() {
    return { ...this._settings }
  }

  saveSettings(patch) {
    this._settings = { ...this._settings, ...patch }
    this._saveSettings()
    return this.getSettings()
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  _loadAccounts() {
    try {
      const data = JSON.parse(fs.readFileSync(this._accFile, 'utf8'))
      if (Array.isArray(data) && data.length > 0) return data
    } catch {}

    const defaultAcc = [{
      id: DEFAULT_ACCOUNT_ID,
      name: 'Mặc định',
      enabled: true,
      threads: 1,
      loggedIn: false,
      quota: { weekly: 0, used: 0, resetAt: 0 },
      lastUsedAt: 0,
      proxy: '',
      proxyAuto: false,
    }]
    this._atomicWrite(this._accFile, defaultAcc)
    return defaultAcc
  }

  _loadSettings() {
    try {
      const data = JSON.parse(fs.readFileSync(this._setFile, 'utf8'))
      return { ...DEFAULT_SETTINGS, ...data }
    } catch {
      this._atomicWrite(this._setFile, DEFAULT_SETTINGS)
      return { ...DEFAULT_SETTINGS }
    }
  }

  _saveAccounts() {
    this._atomicWrite(this._accFile, this._accounts)
  }

  _saveSettings() {
    this._atomicWrite(this._setFile, this._settings)
  }

  _atomicWrite(filePath, data) {
    const tmp = filePath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, filePath)
  }
}

module.exports = AccountStore
