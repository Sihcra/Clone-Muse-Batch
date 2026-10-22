'use strict'
const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const CrmServer = require('../src/engine/crm-server')
const TaskStore = require('../src/engine/task-store')

describe('CRM Server (Local REST API)', () => {
  let tmpDir
  let taskStore
  let crm
  const testPort = 48901
  const testApiKey = 'test-secret-key-123'

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'))
    taskStore = new TaskStore(tmpDir)
    crm = new CrmServer({
      port: testPort,
      taskStore,
      getApiKey: () => testApiKey,
    })
    await crm.start()
  })

  after(async () => {
    await crm.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects requests without valid API key with 401', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/tasks`)
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.ok, false)
  })

  it('allows task creation with valid X-API-Key', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': testApiKey,
      },
      body: JSON.stringify({
        prompt: 'Video bán hàng',
        ratio: '9:16',
        kind: 'video',
      }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(body.taskId)
  })

  it('lists tasks with Authorization Bearer token', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/v1/tasks`, {
      headers: {
        Authorization: `Bearer ${testApiKey}`,
      },
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(Array.isArray(body.tasks))
    assert.equal(body.tasks.length, 1)
  })
})
