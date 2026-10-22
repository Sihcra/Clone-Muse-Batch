'use strict'
// Polyfill global File for Electron runtime (compatibility with undici / cheerio)
if (typeof globalThis.File === 'undefined') {
  try {
    const { File } = require('node:buffer')
    if (File) globalThis.File = File
  } catch {}
}

// main.js — Electron main process
// Orchestrates: window lifecycle, IPC routing → engine modules
// Rule: NO business logic here — only route IPC calls to the right module

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const TaskStore = require('./engine/task-store')
const AccountStore = require('./engine/accounts')
const Pool = require('./engine/pool')
const { Chrome } = require('./engine/chrome')
const { MusePage } = require('./engine/muse-page')
const { scrapeLadiPage } = require('./engine/ladi-crawler')
const { generateScript } = require('./engine/product-ai')
const { mergeScenes } = require('./engine/merge')
const CrmServer = require('./engine/crm-server')
const LicenseManager = require('./engine/license-manager')
const { CDP_PORT_BASE, CRM_PORT } = require('./engine/constants')

const USER_DATA = app.getPath('userData')

// ── Singletons ─────────────────────────────────────────────────────────────
const taskStore = new TaskStore(USER_DATA)
const accountStore = new AccountStore(USER_DATA)
const chromeInstances = new Map() // accountId → Chrome
const musePageInstances = new Map() // accountId → MusePage

async function getPageForAccount(accountId) {
  if (musePageInstances.has(accountId)) {
    return musePageInstances.get(accountId)
  }
  const acc = accountStore.getAccount(accountId)
  const port = CDP_PORT_BASE + Math.abs(accountId.split('').reduce((a, b) => (a << 5) - a + b.charCodeAt(0), 0) % 50)
  const profilePath = path.join(USER_DATA, 'profiles', accountId)

  let chrome = chromeInstances.get(accountId)
  if (!chrome) {
    chrome = new Chrome({ profilePath, proxy: acc?.proxy, port })
    await chrome.launch()
    chromeInstances.set(accountId, chrome)
  }

  const musePage = new MusePage(chrome.cdp)
  await musePage.injectBridge()
  musePageInstances.set(accountId, musePage)
  return musePage
}

const pool = new Pool({
  taskStore,
  accountStore,
  getPageForAccount,
  onTaskUpdate: (task) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('task:status-changed', task)
    }
  },
})

const crmServer = new CrmServer({
  taskStore,
  getApiKey: () => accountStore.getSettings()?.apiKey || 'musebatch-secret-key',
  onLog: (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('crm:log', msg)
    }
  },
})

// ── Window ─────────────────────────────────────────────────────────────────
let mainWindow = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'))
  return mainWindow
}

app.whenReady().then(() => {
  createMainWindow()
  registerIpcHandlers()
  pool.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  pool.stop()
  crmServer.stop()
  for (const chrome of chromeInstances.values()) chrome.kill()
})

// ── Validation helper ──────────────────────────────────────────────────────
function validate(schema, data) {
  for (const [key, type] of Object.entries(schema)) {
    if (typeof data?.[key] !== type) return `Invalid or missing field: ${key} (expected ${type})`
  }
  return null
}

// ── IPC Handlers ───────────────────────────────────────────────────────────
function registerIpcHandlers() {

  // ── Tasks ──────────────────────────────────────────────────────────────
  ipcMain.handle('task:create', (_, payload) => {
    const err = validate({ prompt: 'string', ratio: 'string', kind: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      const task = taskStore.create(payload)
      return { ok: true, taskId: task.id }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('task:list', (_, payload = {}) => {
    try {
      const tasks = taskStore.findAll(payload)
      return { ok: true, tasks }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('task:cancel', (_, payload) => {
    const err = validate({ taskId: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      taskStore.update(payload.taskId, { status: 'cancelled' })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('task:retry', (_, payload) => {
    const err = validate({ taskId: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      taskStore.update(payload.taskId, { status: 'queued', error: null, attempts: 0 })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('task:delete', (_, payload) => {
    const err = validate({ taskId: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      taskStore.remove(payload.taskId)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── Accounts ───────────────────────────────────────────────────────────
  ipcMain.handle('account:list', () => {
    try {
      return { ok: true, accounts: accountStore.getAccounts() }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('account:save', (_, payload) => {
    try {
      const saved = accountStore.saveAccount(payload)
      return { ok: true, account: saved }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('account:delete', (_, payload) => {
    const err = validate({ id: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      accountStore.deleteAccount(payload.id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('account:open-browser', async (_, payload) => {
    const err = validate({ id: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      await getPageForAccount(payload.id)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('account:refresh-quota', async (_, payload) => {
    const err = validate({ id: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      const quota = await pool.refreshQuota(payload.id)
      return { ok: true, quota }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── Settings ───────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => {
    try {
      return { ok: true, settings: accountStore.getSettings() }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('settings:save', (_, payload) => {
    try {
      const settings = accountStore.saveSettings(payload)
      return { ok: true, settings }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── Engine / CDP test ──────────────────────────────────────────────────
  ipcMain.handle('engine:test-chrome', async (_, payload = {}) => {
    const accountId = payload.accountId ?? 'default'
    try {
      await getPageForAccount(accountId)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── Open folder ─────────────────────────────────────────────────────────
  ipcMain.handle('video:open-folder', async (_, payload) => {
    const err = validate({ filePath: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      await shell.showItemInFolder(payload.filePath)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── Crawler & Script AI & Video ──────────────────────────────────────────
  ipcMain.handle('crawler:scrape', async (_, payload) => {
    const err = validate({ url: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      const data = await scrapeLadiPage(payload.url)
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('product-ai:gen', (_, payload) => {
    const err = validate({ title: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      const result = generateScript(payload)
      return { ok: true, scenes: result.scenes }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('video:merge-test', async (_, payload) => {
    const err = validate({ videoPaths: 'object', outputPath: 'string' }, payload)
    if (err) return { ok: false, error: err }
    try {
      const out = await mergeScenes(payload.videoPaths, payload.outputPath, payload.options)
      return { ok: true, outputPath: out }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // ── CRM & License ────────────────────────────────────────────────────────
  ipcMain.handle('crm:get-status', () => {
    return {
      ok: true,
      running: crmServer.running,
      port: CRM_PORT,
      apiKey: accountStore.getSettings()?.apiKey || 'musebatch-secret-key',
    }
  })

  ipcMain.handle('crm:toggle', async (_, payload) => {
    try {
      if (payload?.enable && !crmServer.running) {
        await crmServer.start()
      } else if (!payload?.enable && crmServer.running) {
        await crmServer.stop()
      }
      return { ok: true, running: crmServer.running }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('license:check', (_, payload = {}) => {
    const key = payload.key || accountStore.getSettings()?.licenseKey || ''
    const info = LicenseManager.verify(key)
    return {
      ok: true,
      machineId: LicenseManager.getMachineId(),
      ...info,
    }
  })
}
