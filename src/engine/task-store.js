'use strict'
// task-store.js — JSON-based task persistence & state machine
// Repository pattern: findAll, findById, create, update, remove
// Atomic write: write .tmp then rename to prevent corruption

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { MAX_TASKS, TASK_IMAGES_DIR } = require('./constants')

class TaskStore {
  /** @param {string} userDataDir */
  constructor(userDataDir) {
    this._file = path.join(userDataDir, 'tasks.json')
    this._tmp = this._file + '.tmp'
    this._imagesDir = path.join(userDataDir, TASK_IMAGES_DIR)
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.mkdirSync(this._imagesDir, { recursive: true })
    this._tasks = this._load()
  }

  // ── Public API (Repository interface) ─────────────────────────────────────

  /**
   * @param {{ status?: string }} [filter]
   * @returns {Task[]}
   */
  findAll(filter = {}) {
    if (!filter.status) return [...this._tasks]
    return this._tasks.filter(t => t.status === filter.status)
  }

  /**
   * @param {string} id
   * @returns {Task|null}
   */
  findById(id) {
    return this._tasks.find(t => t.id === id) ?? null
  }

  /**
   * @param {Partial<Task>} data
   * @returns {Task}
   */
  create(data) {
    const task = {
      id: randomUUID(),
      source: data.source ?? 'ui',
      label: data.label ?? '',
      prompt: data.prompt ?? '',
      images: data.images ?? [],
      kind: data.kind ?? 'video',
      ratio: data.ratio ?? '9:16',
      sessionId: null,
      accountId: null,
      thread: null,
      pin: false,
      timeoutMin: data.timeoutMin ?? 10,
      status: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      files: [],
      error: null,
      held: false,
      project: data.project ?? null,
    }
    this._tasks = [...this._tasks, task]
    this._purge()
    this._save()
    return task
  }

  /**
   * Returns a new task object — does NOT mutate the stored reference.
   * @param {string} id
   * @param {Partial<Task>} patch
   * @returns {Task}
   */
  update(id, patch) {
    let updated = null
    this._tasks = this._tasks.map(t => {
      if (t.id !== id) return t
      updated = { ...t, ...patch }
      return updated
    })
    if (!updated) throw new Error(`Task not found: ${id}`)
    this._save()
    return updated
  }

  /**
   * @param {string} id
   */
  remove(id) {
    this._tasks = this._tasks.filter(t => t.id !== id)
    this._save()
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _load() {
    try {
      const raw = fs.readFileSync(this._file, 'utf8')
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  /** FIFO purge: keep only the newest MAX_TASKS tasks */
  _purge() {
    if (this._tasks.length > MAX_TASKS) {
      this._tasks = this._tasks.slice(this._tasks.length - MAX_TASKS)
    }
  }

  /** Atomic write: .tmp → rename */
  _save() {
    const json = JSON.stringify(this._tasks, null, 2)
    fs.writeFileSync(this._tmp, json, 'utf8')
    fs.renameSync(this._tmp, this._file)
  }
}

module.exports = TaskStore

/**
 * @typedef {{
 *   id: string,
 *   source: string,
 *   label: string,
 *   prompt: string,
 *   images: string[],
 *   kind: 'video'|'image',
 *   ratio: string,
 *   sessionId: string|null,
 *   accountId: string|null,
 *   thread: string|null,
 *   pin: boolean,
 *   timeoutMin: number,
 *   status: 'queued'|'processing'|'succeeded'|'failed'|'cancelled',
 *   attempts: number,
 *   createdAt: string,
 *   startedAt: string|null,
 *   finishedAt: string|null,
 *   files: string[],
 *   error: string|null,
 *   held: boolean,
 *   project: string|null,
 * }} Task
 */
