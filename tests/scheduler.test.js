'use strict'
// scheduler.test.js — TDD for pure scheduler logic
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  weeklyOut,
  pausedUntil,
  isUsable,
  plan,
} = require('../src/engine/scheduler')

describe('Scheduler (Pure Logic)', () => {
  describe('weeklyOut()', () => {
    it('returns true when used >= weekly', () => {
      assert.equal(weeklyOut({ weekly: 100, used: 100 }), true)
      assert.equal(weeklyOut({ weekly: 100, used: 105 }), true)
    })

    it('returns false when used < weekly or quota missing', () => {
      assert.equal(weeklyOut({ weekly: 100, used: 99 }), false)
      assert.equal(weeklyOut(null), false)
      assert.equal(weeklyOut({}), false)
    })
  })

  describe('isUsable()', () => {
    it('returns false if account is disabled or not logged in', () => {
      const now = Date.now()
      assert.equal(isUsable({ enabled: false, loggedIn: true }, {}, now), false)
      assert.equal(isUsable({ enabled: true, loggedIn: false }, {}, now), false)
    })

    it('returns false if account is paused due to quota exhaustion', () => {
      const now = Date.now()
      const acc = {
        enabled: true,
        loggedIn: true,
        quota: { weekly: 10, used: 10, resetAt: now + 60_000 },
      }
      assert.equal(isUsable(acc, { keepGoing: false }, now), false)
    })

    it('returns true when valid and has quota', () => {
      const now = Date.now()
      const acc = {
        enabled: true,
        loggedIn: true,
        quota: { weekly: 10, used: 5 },
      }
      assert.equal(isUsable(acc, {}, now), true)
    })
  })

  describe('plan() matchmaking', () => {
    const settings = { maxAccounts: 2, totalThreads: 2, mode: 'rotate', keepGoing: false }
    const now = 1700000000000

    it('pairs in-progress task with its assigned account if usable', () => {
      const tasks = [
        { id: 't1', status: 'processing', sessionId: 's123', accountId: 'acc1' }
      ]
      const accounts = [
        { id: 'acc1', enabled: true, loggedIn: true, threads: 2 }
      ]
      const pairs = plan({ tasks, accounts, settings, runningTasks: [], now })
      assert.equal(pairs.length, 1)
      assert.equal(pairs[0].task.id, 't1')
      assert.equal(pairs[0].accountId, 'acc1')
    })

    it('prioritizes accounts with lowest quota usage and oldest lastUsedAt', () => {
      const tasks = [
        { id: 't2', status: 'queued', sessionId: null }
      ]
      const accounts = [
        { id: 'acc1', enabled: true, loggedIn: true, threads: 1, lastUsedAt: 1000, quota: { weekly: 10, used: 5 } },
        { id: 'acc2', enabled: true, loggedIn: true, threads: 1, lastUsedAt: 500, quota: { weekly: 10, used: 2 } }
      ]
      const pairs = plan({ tasks, accounts, settings, runningTasks: [], now })
      assert.equal(pairs.length, 1)
      assert.equal(pairs[0].accountId, 'acc2') // acc2 has more quota remaining (20% used vs 50% used)
    })

    it('respects account concurrency / threads limit', () => {
      const tasks = [
        { id: 't1', status: 'queued' },
        { id: 't2', status: 'queued' }
      ]
      const accounts = [
        { id: 'acc1', enabled: true, loggedIn: true, threads: 1 }
      ]
      const runningTasks = [
        { id: 'r1', accountId: 'acc1' }
      ]
      const pairs = plan({ tasks, accounts, settings, runningTasks, now })
      // acc1 thread capacity is 1, and 1 task is already running on acc1
      assert.equal(pairs.length, 0)
    })
  })
})
