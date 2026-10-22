'use strict'
// muse-page.js — Muse.ai CDP automation
// Injects window.__mss bridge, sends prompts via React Fiber traversal,
// polls session status, downloads artifacts in 2MB chunks.

const fs = require('node:fs')
const path = require('node:path')
const { CHUNK_SIZE_BYTES } = require('./constants')

// Injected into the Muse page — finds React Fiber & exposes __mss helpers
const BRIDGE_SCRIPT = /* js */`
(function() {
  if (window.__mss) return;

  function findFiberNode(root, test, maxDepth = 500) {
    let node = root;
    let depth = 0;
    while (node && depth++ < maxDepth) {
      if (node.memoizedProps && test(node.memoizedProps)) return node;
      node = node.child ?? node.sibling ?? node.return?.sibling;
    }
    return null;
  }

  function getFiberRoot() {
    const el = document.getElementById('root') ?? document.querySelector('[data-reactroot]');
    if (!el) return null;
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    return key ? el[key] : null;
  }

  window.__mss = {
    sendMessage(text, attachments, threadId) {
      const root = getFiberRoot();
      if (!root) return { ok: false, error: 'React root not found' };
      const node = findFiberNode(root, p =>
        typeof p.value?.sendMessage === 'function' && p.value?.ensureActiveChatSendReady
      );
      if (!node) return { ok: false, error: 'sendMessage hook not found' };
      const { sendMessage, ensureActiveChatSendReady } = node.memoizedProps.value;
      ensureActiveChatSendReady();
      const payload = { text, attachments: attachments || [] };
      if (threadId) payload.targetRoute = { kind: 'thread', sessionId: threadId };
      sendMessage(payload);
      return { ok: true };
    },

    findSessionInput() {
      const input = document.querySelector('textarea[placeholder], input[placeholder]');
      return input ? input.placeholder : null;
    }
  };
})();
`

class MusePage {
  /** @param {import('./chrome').CdpConnection} cdp */
  constructor(cdp) {
    this._cdp = cdp
    this._bridgeInjected = false
  }

  /** Inject __mss bridge into the page */
  async injectBridge() {
    await this._cdp.cmd('Page.addScriptToEvaluateOnNewDocument', { source: BRIDGE_SCRIPT })
    await this._cdp.evaluate(BRIDGE_SCRIPT)
    this._bridgeInjected = true
  }

  /**
   * Check if user is logged in via /api/session cookie check.
   * @returns {Promise<boolean>}
   */
  async checkSession() {
    const result = await this._cdp.evaluate(`
      fetch('/api/session', { credentials: 'include' })
        .then(r => r.json())
        .then(d => !!(d && (d.user || d.id || d.email)))
        .catch(() => false)
    `, 10_000)
    return result === true
  }

  /**
   * Send a prompt via React Fiber sendMessage.
   * @param {string} text
   * @param {string[]} [imageUrls]
   * @param {string|null} [threadId]
   * @returns {Promise<void>}
   */
  async sendPrompt(text, imageUrls = [], threadId = null) {
    if (!this._bridgeInjected) await this.injectBridge()

    const escaped = JSON.stringify(text)
    const escapedThread = threadId ? JSON.stringify(threadId) : 'null'
    const result = await this._cdp.evaluate(
      `window.__mss.sendMessage(${escaped}, [], ${escapedThread})`,
      15_000
    )
    if (!result?.ok) throw new Error(result?.error ?? 'sendMessage failed')
  }

  /**
   * Poll session status via Muse RPC.
   * @param {string} sessionId
   * @returns {Promise<{ status: string, progress?: number }>}
   */
  async pollStatus(sessionId) {
    const result = await this._cdp.evaluate(`
      fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ method: 'sessions.list', params: {} })
      }).then(r => r.json()).catch(e => ({ error: e.message }))
    `, 10_000)

    if (result?.error) throw new Error(result.error)
    const sessions = result?.result ?? []
    const session = sessions.find(s => s.id === sessionId)
    if (!session) return { status: 'unknown' }
    return { status: session.status, progress: session.progress }
  }

  /**
   * Get chat history for a session to extract output file URLs.
   * @param {string} sessionId
   * @returns {Promise<string[]>} list of file URLs
   */
  async getResultUrls(sessionId) {
    const result = await this._cdp.evaluate(`
      fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ method: 'chat.history', params: { sessionId: ${JSON.stringify(sessionId)} } })
      }).then(r => r.json()).catch(e => ({ error: e.message }))
    `, 10_000)

    if (result?.error) throw new Error(result.error)
    const messages = result?.result ?? []
    const urls = []
    for (const msg of messages) {
      if (msg.attachments) urls.push(...msg.attachments.map(a => a.url).filter(Boolean))
    }
    return urls
  }

  /**
   * Download a Muse file via fs.raw RPC in 2MB base64 chunks.
   * @param {string} musePath  server-side path returned by Muse
   * @param {string} savePath  local disk path to write
   */
  async downloadFile(musePath, savePath) {
    const chunkSize = CHUNK_SIZE_BYTES
    let offset = 0
    const writeStream = fs.createWriteStream(savePath)

    try {
      while (true) {
        const result = await this._cdp.evaluate(`
          fetch('/api/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              method: 'fs.raw',
              params: { path: ${JSON.stringify(musePath)}, offset: ${offset}, length: ${chunkSize} }
            })
          }).then(r => r.json()).catch(e => ({ error: e.message }))
        `, 30_000)

        if (result?.error) throw new Error(result.error)
        const chunk = result?.result?.data
        if (!chunk) break

        const buf = Buffer.from(chunk, 'base64')
        await new Promise((res, rej) => writeStream.write(buf, err => err ? rej(err) : res()))
        offset += buf.length
        if (buf.length < chunkSize) break
      }
    } finally {
      await new Promise(res => writeStream.end(res))
    }
  }

  /**
   * Cancel an in-progress session.
   * @param {string} sessionId
   */
  async cancelSession(sessionId) {
    await this._cdp.evaluate(`
      fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ method: 'chat.cancel', params: { sessionId: ${JSON.stringify(sessionId)} } })
      }).then(r => r.json())
    `, 10_000)
  }

  /**
   * Read Muse subscription quota by finding Next.js server action ID.
   * @returns {Promise<{ weekly: number, used: number } | null>}
   */
  async readQuota() {
    const result = await this._cdp.evaluate(`
      fetch('/api/quota', { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    `, 10_000)
    return result
  }
}

module.exports = { MusePage }
