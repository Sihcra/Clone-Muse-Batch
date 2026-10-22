'use strict'
// preload.js — contextBridge: only expose what the renderer actually needs
// Security: no ipcRenderer exposure, no Node access from renderer

const { contextBridge, ipcRenderer } = require('electron')

// Whitelist of channels the renderer may invoke
const INVOKE_CHANNELS = new Set([
  'task:create',
  'task:list',
  'task:cancel',
  'task:retry',
  'task:delete',
  'account:list',
  'account:save',
  'account:delete',
  'account:open-browser',
  'account:refresh-quota',
  'settings:get',
  'settings:save',
  'crawler:scrape',
  'product-ai:gen',
  'video:open-folder',
  'video:merge-test',
  'crm:get-status',
  'crm:toggle',
  'fb:get-pages',
  'fb:post-reels',
  'license:check',
  'engine:test-chrome',
])

// Channels the main process may push to renderer
const PUSH_CHANNELS = new Set([
  'task:status-changed',
  'crm:log',
])

contextBridge.exposeInMainWorld('api', {
  /**
   * Two-way invoke: renderer calls main, awaits response.
   * @param {string} channel
   * @param {any} payload
   */
  invoke(channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.resolve({ ok: false, error: `Unknown channel: ${channel}` })
    }
    return ipcRenderer.invoke(channel, payload)
  },

  /**
   * Subscribe to push events from main.
   * @param {string} channel
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  on(channel, handler) {
    if (!PUSH_CHANNELS.has(channel)) return () => {}
    const wrapped = (_, ...args) => handler(...args)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
})
