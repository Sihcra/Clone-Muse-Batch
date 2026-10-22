'use strict'
// scheduler.js — Pure scheduling logic (matchmaking task <-> account)
// ECC Rule: Pure functions, zero I/O, deterministic

/**
 * Checks if quota limit is exhausted.
 * @param {{ weekly?: number, used?: number }} [quota]
 * @returns {boolean}
 */
function weeklyOut(quota) {
  if (!quota || typeof quota.weekly !== 'number' || typeof quota.used !== 'number') {
    return false
  }
  return quota.used >= quota.weekly
}

/**
 * Returns timestamp until which the account is paused, or 0 if not paused.
 * @param {object} acc
 * @param {object} settings
 * @param {number} now
 * @returns {number}
 */
function pausedUntil(acc, settings = {}, now = Date.now()) {
  if (settings.keepGoing) return 0
  if (weeklyOut(acc.quota)) {
    return acc.quota?.resetAt && acc.quota.resetAt > now ? acc.quota.resetAt : now + 3600_000
  }
  return 0
}

/**
 * Checks if an account is ready to accept new or ongoing tasks.
 * @param {object} acc
 * @param {object} settings
 * @param {number} now
 * @returns {boolean}
 */
function isUsable(acc, settings = {}, now = Date.now()) {
  if (!acc || !acc.enabled || !acc.loggedIn) return false
  if (pausedUntil(acc, settings, now) > now) return false
  return true
}

/**
 * Pure matchmaking algorithm.
 * @param {{
 *   tasks: Array<object>,
 *   accounts: Array<object>,
 *   settings: object,
 *   runningTasks?: Array<object>,
 *   now?: number
 * }} params
 * @returns {Array<{ task: object, accountId: string }>}
 */
function plan({ tasks, accounts, settings = {}, runningTasks = [], now = Date.now() }) {
  const usableAccounts = accounts.filter(acc => isUsable(acc, settings, now))
  if (usableAccounts.length === 0) return []

  // Track busy thread counts per account
  const busyCount = new Map()
  for (const acc of usableAccounts) {
    busyCount.set(acc.id, 0)
  }
  for (const rt of runningTasks) {
    if (rt.accountId && busyCount.has(rt.accountId)) {
      busyCount.set(rt.accountId, busyCount.get(rt.accountId) + 1)
    }
  }

  const pairs = []
  const assignedTaskIds = new Set(runningTasks.map(t => t.id))

  // Helper to check availability
  const hasCapacity = (accId) => {
    const acc = usableAccounts.find(a => a.id === accId)
    const limit = acc?.threads ?? settings.totalThreads ?? 1
    return (busyCount.get(accId) || 0) < limit
  }

  // Priority 1: Tasks with existing sessionId (resumed/in-progress)
  for (const task of tasks) {
    if (assignedTaskIds.has(task.id)) continue
    if (task.sessionId && task.accountId && hasCapacity(task.accountId)) {
      pairs.push({ task, accountId: task.accountId })
      assignedTaskIds.add(task.id)
      busyCount.set(task.accountId, busyCount.get(task.accountId) + 1)
    }
  }

  // Priority 2: Tasks pinned to an account thread
  for (const task of tasks) {
    if (assignedTaskIds.has(task.id)) continue
    if (task.pin && task.accountId && hasCapacity(task.accountId)) {
      pairs.push({ task, accountId: task.accountId })
      assignedTaskIds.add(task.id)
      busyCount.set(task.accountId, busyCount.get(task.accountId) + 1)
    }
  }

  // Priority 3: Queued tasks sorted by FIFO
  const queuedTasks = tasks.filter(t => t.status === 'queued' && !assignedTaskIds.has(t.id))

  for (const task of queuedTasks) {
    // Find candidate accounts with capacity
    const candidates = usableAccounts.filter(acc => hasCapacity(acc.id))
    if (candidates.length === 0) break

    // Sort candidates: lowest quota used %, then oldest lastUsedAt
    candidates.sort((a, b) => {
      const quotaPctA = a.quota?.weekly ? (a.quota.used / a.quota.weekly) : 0
      const quotaPctB = b.quota?.weekly ? (b.quota.used / b.quota.weekly) : 0
      if (quotaPctA !== quotaPctB) return quotaPctA - quotaPctB
      return (a.lastUsedAt || 0) - (b.lastUsedAt || 0)
    })

    const chosen = candidates[0]
    pairs.push({ task, accountId: chosen.id })
    assignedTaskIds.add(task.id)
    busyCount.set(chosen.id, (busyCount.get(chosen.id) || 0) + 1)
  }

  return pairs
}

module.exports = {
  weeklyOut,
  pausedUntil,
  isUsable,
  plan,
}
