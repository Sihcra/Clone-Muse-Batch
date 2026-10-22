'use strict'
// pool.js — Parallel execution pool with anti-ban jitter & login verification
// Coordinates: Scheduler -> Chrome/MusePage -> TaskStore

const {
  PUMP_INTERVAL_MS,
  ANTI_BAN_MIN_MS,
  ANTI_BAN_MAX_MS,
  CHECK_LOGIN_RETRIES,
  CHECK_LOGIN_INTERVAL_MS,
} = require('./constants')
const { plan } = require('./scheduler')

class Pool {
  /**
   * @param {{
   *   taskStore: import('./task-store'),
   *   accountStore: import('./accounts'),
   *   getPageForAccount: (accId: string) => Promise<import('./muse-page').MusePage>,
   *   onTaskUpdate?: (task: object) => void
   * }} opts
   */
  constructor({ taskStore, accountStore, getPageForAccount, onTaskUpdate }) {
    this.taskStore = taskStore
    this.accountStore = accountStore
    this.getPageForAccount = getPageForAccount
    this.onTaskUpdate = onTaskUpdate || (() => {})

    this._runningTasks = new Map() // taskId -> { task, accountId }
    this._lastSubmitAt = new Map() // accountId -> timestamp
    this._timer = null
    this._pumping = false
  }

  start() {
    if (this._timer) return
    this._timer = setInterval(() => this.pump(), PUMP_INTERVAL_MS)
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  /** Main coordination pump */
  async pump() {
    if (this._pumping) return
    this._pumping = true

    try {
      const tasks = this.taskStore.findAll()
      const accounts = this.accountStore.getAccounts()
      const settings = this.accountStore.getSettings()
      const running = Array.from(this._runningTasks.values())

      const pairs = plan({
        tasks,
        accounts,
        settings,
        runningTasks: running,
        now: Date.now(),
      })

      for (const { task, accountId } of pairs) {
        if (this._runningTasks.has(task.id)) continue
        this._runningTasks.set(task.id, { task, accountId })
        // Fire-and-forget task execution inside worker pool
        this.runOne(task, accountId).finally(() => {
          this._runningTasks.delete(task.id)
        })
      }
    } catch (err) {
      console.error('[Pool] pump error:', err)
    } finally {
      this._pumping = false
    }
  }

  /**
   * Run a single task under anti-ban constraints.
   * @param {object} task
   * @param {string} accountId
   */
  async runOne(task, accountId) {
    try {
      this.taskStore.update(task.id, {
        status: 'processing',
        accountId,
        startedAt: new Date().toISOString(),
      })
      this.onTaskUpdate(this.taskStore.findById(task.id))

      // Anti-ban jitter: wait if last submit on this account was too recent
      await this._applyAntiBanJitter(accountId)

      const musePage = await this.getPageForAccount(accountId)
      const loggedIn = await musePage.checkSession()
      if (!loggedIn) {
        throw new Error(`Account ${accountId} is not logged in to Muse.ai`)
      }

      this._lastSubmitAt.set(accountId, Date.now())
      this.accountStore.updateAccount(accountId, { lastUsedAt: Date.now() })

      // Send prompt via React Fiber injection
      await musePage.sendPrompt(task.prompt, task.images, task.thread)

      // Polling or status tracking placeholder (handled via callbacks/RPC)
      this.taskStore.update(task.id, {
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
      })
      this.onTaskUpdate(this.taskStore.findById(task.id))
    } catch (err) {
      console.error(`[Pool] Task ${task.id} failed:`, err.message)
      this.taskStore.update(task.id, {
        status: 'failed',
        error: err.message,
        finishedAt: new Date().toISOString(),
      })
      this.onTaskUpdate(this.taskStore.findById(task.id))
    }
  }

  async checkLogin(accountId, maxRetries = CHECK_LOGIN_RETRIES) {
    const musePage = await this.getPageForAccount(accountId)
    for (let i = 0; i < maxRetries; i++) {
      const loggedIn = await musePage.checkSession()
      if (loggedIn) {
        this.accountStore.updateAccount(accountId, { loggedIn: true })
        return true
      }
      await sleep(CHECK_LOGIN_INTERVAL_MS)
    }
    this.accountStore.updateAccount(accountId, { loggedIn: false })
    return false
  }

  async refreshQuota(accountId) {
    const musePage = await this.getPageForAccount(accountId)
    const quota = await musePage.readQuota()
    if (quota) {
      this.accountStore.updateAccount(accountId, { quota })
    }
    return quota
  }

  async _applyAntiBanJitter(accountId) {
    const last = this._lastSubmitAt.get(accountId) || 0
    const elapsed = Date.now() - last
    const jitter = Math.floor(
      ANTI_BAN_MIN_MS + Math.random() * (ANTI_BAN_MAX_MS - ANTI_BAN_MIN_MS)
    )

    if (elapsed < jitter) {
      const waitMs = jitter - elapsed
      await sleep(waitMs)
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = Pool
