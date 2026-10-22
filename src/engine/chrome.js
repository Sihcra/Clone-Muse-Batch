'use strict'
// chrome.js — Chrome process manager & CDP WebSocket client
// Opens real Chrome with a dedicated profile and connects via CDP WebSocket

const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const WebSocket = require('ws')
const { CDP_PORT_BASE } = require('./constants')

// ── Chrome path detection ──────────────────────────────────────────────────

const CHROME_PATHS_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe')
    : '',
].filter(Boolean)

const CHROME_PATHS_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

/**
 * @returns {string} path to chrome executable
 * @throws if not found
 */
function findChromePath() {
  const candidates = process.platform === 'darwin' ? CHROME_PATHS_MAC : CHROME_PATHS_WIN
  const found = candidates.find(p => p && fs.existsSync(p))
  if (!found) throw new Error('Google Chrome not found. Please install Chrome.')
  return found
}

// ── CDP Connection ─────────────────────────────────────────────────────────

class CdpConnection extends EventEmitter {
  constructor(wsUrl) {
    super()
    this._ws = new WebSocket(wsUrl)
    this._pending = new Map() // id → { resolve, reject }
    this._nextId = 1
    this._ws.on('message', raw => this._onMessage(raw))
    this._ws.on('error', err => this.emit('error', err))
    this._ws.on('close', () => this.emit('close'))
  }

  /** Wait for WebSocket to open */
  ready() {
    return new Promise((resolve, reject) => {
      if (this._ws.readyState === WebSocket.OPEN) return resolve()
      this._ws.once('open', resolve)
      this._ws.once('error', reject)
    })
  }

  /**
   * Send a CDP command and await its response.
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   * @returns {Promise<any>}
   */
  cmd(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++
      const msg = { id, method, params }
      if (sessionId) msg.sessionId = sessionId
      this._pending.set(id, { resolve, reject })
      this._ws.send(JSON.stringify(msg))
    })
  }

  /**
   * Evaluate JS in the page context.
   * @param {string} expression
   * @param {number} [timeoutMs=10000]
   */
  async evaluate(expression, timeoutMs = 10_000) {
    const result = await Promise.race([
      this.cmd('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('evaluate() timed out')), timeoutMs)
      ),
    ])
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'CDP evaluate error')
    }
    return result.result?.value
  }

  close() {
    this._ws.close()
  }

  _onMessage(raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.id && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id)
      this._pending.delete(msg.id)
      if (msg.error) return reject(new Error(msg.error.message))
      resolve(msg.result)
    } else if (msg.method) {
      this.emit(msg.method, msg.params)
    }
  }
}

// ── Chrome launcher ────────────────────────────────────────────────────────

class Chrome {
  /**
   * @param {{ profilePath: string, proxy?: string, port?: number }} opts
   */
  constructor({ profilePath, proxy, port = CDP_PORT_BASE }) {
    this.profilePath = profilePath
    this.proxy = proxy
    this.port = port
    this._proc = null
    this.cdp = null
  }

  /**
   * Launch Chrome and connect CDP.
   * @returns {Promise<CdpConnection>}
   */
  async launch() {
    const chromePath = findChromePath()
    fs.mkdirSync(this.profilePath, { recursive: true })

    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
    ]
    if (this.proxy) args.push(`--proxy-server=${this.proxy}`)
    args.push('https://muse.ai')

    this._proc = spawn(chromePath, args, { stdio: 'ignore', detached: false })
    this._proc.on('error', err => { throw err })

    const wsUrl = await this._getWsUrl()
    this.cdp = new CdpConnection(wsUrl)
    await this.cdp.ready()
    await this.cdp.cmd('Runtime.enable')
    await this.cdp.cmd('Page.enable')
    return this.cdp
  }

  /** Kill Chrome process */
  kill() {
    if (this._proc && !this._proc.killed) this._proc.kill()
    if (this.cdp) this.cdp.close()
    this._proc = null
    this.cdp = null
  }

  /** Poll /json endpoint until Chrome exposes a debuggable page */
  async _getWsUrl(retries = 20, intervalMs = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        const pages = await this._fetchJson()
        const page = pages.find(p => p.type === 'page')
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
      } catch {
        // Chrome not ready yet
      }
      await sleep(intervalMs)
    }
    throw new Error(`Chrome CDP not reachable on port ${this.port} after ${retries} retries`)
  }

  _fetchJson() {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${this.port}/json`, res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
        })
      }).on('error', reject)
    })
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

module.exports = { Chrome, CdpConnection, findChromePath }
