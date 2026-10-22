'use strict'
// crm-server.js — Local HTTP REST API (port 48900)
// ECC Rule: Strict authentication middleware, consistent JSON envelope, native node:http

const http = require('node:http')
const fs = require('node:fs')
const { CRM_PORT, CRM_HOST } = require('./constants')

class CrmServer {
  /**
   * @param {{
   *   port?: number,
   *   host?: string,
   *   taskStore: import('./task-store'),
   *   getApiKey: () => string,
   *   onLog?: (log: string) => void
   * }} opts
   */
  constructor({ port = CRM_PORT, host = CRM_HOST, taskStore, getApiKey, onLog }) {
    this.port = port
    this.host = host
    this.taskStore = taskStore
    this.getApiKey = getApiKey
    this.onLog = onLog || (() => {})
    this._server = null
    this.running = false
  }

  start() {
    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => this._handleRequest(req, res))
      this._server.listen(this.port, this.host, () => {
        this.running = true
        this.onLog(`[CRM Server] Listening on http://${this.host}:${this.port}`)
        resolve()
      })
      this._server.on('error', err => reject(err))
    })
  }

  stop() {
    return new Promise((resolve) => {
      if (!this._server) return resolve()
      this._server.close(() => {
        this.running = false
        this._server = null
        resolve()
      })
    })
  }

  async _handleRequest(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }

    const url = new URL(req.url, `http://${this.host}:${this.port}`)
    const pathname = url.pathname

    // Authentication check
    const apiKey = req.headers['x-api-key'] || this._extractBearer(req.headers['authorization'])
    const expectedKey = this.getApiKey()

    if (!apiKey || apiKey !== expectedKey) {
      return this._sendJson(res, 401, { ok: false, error: 'Unauthorized: Invalid or missing API key' })
    }

    try {
      // Route dispatch
      if (req.method === 'GET' && pathname === '/api/v1/tasks') {
        const status = url.searchParams.get('status')
        const filter = status ? { status } : {}
        const tasks = this.taskStore.findAll(filter)
        return this._sendJson(res, 200, { ok: true, tasks })
      }

      if (req.method === 'POST' && pathname === '/api/v1/tasks') {
        const body = await this._readJsonBody(req)
        if (!body.prompt) {
          return this._sendJson(res, 400, { ok: false, error: 'Field "prompt" is required' })
        }
        const task = this.taskStore.create({
          prompt: body.prompt,
          ratio: body.ratio || '9:16',
          kind: body.kind || 'video',
          source: 'api',
          images: body.images || [],
        })
        return this._sendJson(res, 200, { ok: true, taskId: task.id })
      }

      // Match /api/v1/tasks/:id
      const match = pathname.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/([^/]+))?$/)
      if (match) {
        const taskId = match[1]
        const action = match[2]
        const task = this.taskStore.findById(taskId)

        if (!task) {
          return this._sendJson(res, 404, { ok: false, error: 'Task not found' })
        }

        if (!action && req.method === 'GET') {
          return this._sendJson(res, 200, { ok: true, task })
        }

        if (action === 'cancel' && req.method === 'POST') {
          this.taskStore.update(taskId, { status: 'cancelled' })
          return this._sendJson(res, 200, { ok: true })
        }

        if (action === 'retry' && req.method === 'POST') {
          this.taskStore.update(taskId, { status: 'queued', error: null, attempts: 0 })
          return this._sendJson(res, 200, { ok: true })
        }

        if (action === 'file' && req.method === 'GET') {
          const index = parseInt(url.searchParams.get('i') || '0', 10)
          const filePath = task.files?.[index]
          if (!filePath || !fs.existsSync(filePath)) {
            return this._sendJson(res, 404, { ok: false, error: 'Video file not ready or not found' })
          }
          res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Content-Length': fs.statSync(filePath).size,
          })
          fs.createReadStream(filePath).pipe(res)
          return
        }
      }

      return this._sendJson(res, 404, { ok: false, error: 'Not Found' })
    } catch (err) {
      return this._sendJson(res, 500, { ok: false, error: err.message })
    }
  }

  _sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  _extractBearer(authHeader) {
    if (!authHeader) return null
    const parts = authHeader.split(' ')
    return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : null
  }

  _readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', chunk => { data += chunk })
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch (e) {
          reject(new Error('Invalid JSON payload'))
        }
      })
      req.on('error', reject)
    })
  }
}

module.exports = CrmServer
