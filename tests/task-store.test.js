'use strict'
// TDD: Run with `node --test tests/task-store.test.js`

const { describe, it, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

// Create a temp userData dir for each test run
let tmpDir
let TaskStore

describe('TaskStore', () => {
  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'musebatch-test-'))
    // Require after tmpDir is ready so we can override userData path
    process.env.MUSEBATCH_USER_DATA = tmpDir
    TaskStore = require('../src/engine/task-store')
  })

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('create()', () => {
    it('returns a task with queued status and generated id', () => {
      const store = new TaskStore(tmpDir)
      const task = store.create({ prompt: 'hello', ratio: '9:16', kind: 'video' })

      assert.equal(task.status, 'queued')
      assert.match(task.id, /^[0-9a-f-]{36}$/)
      assert.equal(task.prompt, 'hello')
      assert.equal(task.ratio, '9:16')
      assert.equal(task.attempts, 0)
      assert.ok(task.createdAt)
    })

    it('persists task to tasks.json atomically', () => {
      const store = new TaskStore(tmpDir)
      store.create({ prompt: 'persist test', ratio: '16:9', kind: 'video' })

      const raw = fs.readFileSync(path.join(tmpDir, 'tasks.json'), 'utf8')
      const saved = JSON.parse(raw)
      assert.ok(Array.isArray(saved))
      assert.ok(saved.some(t => t.prompt === 'persist test'))

      // tmp file must not remain
      assert.equal(fs.existsSync(path.join(tmpDir, 'tasks.json.tmp')), false)
    })
  })

  describe('findAll()', () => {
    it('returns all tasks when no filter', () => {
      const store = new TaskStore(path.join(tmpDir, 'findall'))
      store.create({ prompt: 'a', ratio: '9:16', kind: 'video' })
      store.create({ prompt: 'b', ratio: '9:16', kind: 'image' })

      const all = store.findAll()
      assert.equal(all.length, 2)
    })

    it('filters by status', () => {
      const store = new TaskStore(path.join(tmpDir, 'filter'))
      const t1 = store.create({ prompt: 'q1', ratio: '9:16', kind: 'video' })
      store.create({ prompt: 'q2', ratio: '9:16', kind: 'video' })
      store.update(t1.id, { status: 'succeeded' })

      const queued = store.findAll({ status: 'queued' })
      assert.equal(queued.length, 1)
      assert.equal(queued[0].prompt, 'q2')
    })
  })

  describe('update() — immutability', () => {
    it('returns a new task object, does not mutate original reference', () => {
      const store = new TaskStore(path.join(tmpDir, 'immut'))
      const original = store.create({ prompt: 'orig', ratio: '9:16', kind: 'video' })
      const originalRef = store.findById(original.id)

      const updated = store.update(original.id, { status: 'processing' })

      assert.equal(updated.status, 'processing')
      // original reference must be unchanged
      assert.equal(originalRef.status, 'queued')
    })

    it('persists updated status to disk', () => {
      const store = new TaskStore(path.join(tmpDir, 'persist-update'))
      const task = store.create({ prompt: 'update me', ratio: '9:16', kind: 'video' })
      store.update(task.id, { status: 'succeeded', files: ['/out/video.mp4'] })

      // Re-load store from disk
      const store2 = new TaskStore(path.join(tmpDir, 'persist-update'))
      const loaded = store2.findById(task.id)
      assert.equal(loaded.status, 'succeeded')
      assert.deepEqual(loaded.files, ['/out/video.mp4'])
    })
  })

  describe('FIFO purge at MAX_TASKS', () => {
    it('removes oldest tasks when count exceeds MAX_TASKS', () => {
      const { MAX_TASKS } = require('../src/engine/constants')
      const store = new TaskStore(path.join(tmpDir, 'purge'))

      // Create MAX_TASKS + 5 tasks
      for (let i = 0; i < MAX_TASKS + 5; i++) {
        store.create({ prompt: `task-${i}`, ratio: '9:16', kind: 'video' })
      }

      const all = store.findAll()
      assert.ok(all.length <= MAX_TASKS, `Expected ≤${MAX_TASKS}, got ${all.length}`)
      // Oldest should be gone — task-0 through task-4
      assert.equal(all.some(t => t.prompt === 'task-0'), false)
    })
  })

  describe('remove()', () => {
    it('removes task by id', () => {
      const store = new TaskStore(path.join(tmpDir, 'remove'))
      const task = store.create({ prompt: 'delete me', ratio: '9:16', kind: 'video' })
      store.remove(task.id)

      assert.equal(store.findById(task.id), null)
    })
  })
})
