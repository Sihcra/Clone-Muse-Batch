'use strict';
/**
 * LOCAL API SERVER — http://127.0.0.1:48900 (chỉ máy này gọi được).
 * - API cũ cho Content CRM (không cần khoá): GET /api/status, POST /api/render, GET /api/videos
 * - API v1 (cần khoá: "Authorization: Bearer <key>" hoặc "X-API-Key: <key>"):
 *     GET    /api/v1/tasks?status=&limit=
 *     POST   /api/v1/tasks              { prompt, images?, timeoutMin?, label?, kind?, expect?, thread?, ratio? }
 *     GET    /api/v1/tasks/:id
 *     POST   /api/v1/tasks/:id/cancel
 *     POST   /api/v1/tasks/:id/retry
 *     DELETE /api/v1/tasks/:id
 *     GET    /api/v1/tasks/:id/file?i=0
 */

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const MAX_BODY = 40 * 1024 * 1024; // đủ cho vài ảnh base64
const MIME = { mp4: 'video/mp4', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

// Không lộ đường dẫn nội bộ khi trả task ra ngoài
const publicTask = t => t && ({ ...t, images: t.images.length, files: t.files.map(f => path.basename(f)) });

class CrmServer {
  constructor(port = 48900, { onJobReceived, apiKey, tasks } = {}) {
    this.port = port;
    this.onJobReceived = onJobReceived;
    this.apiKey = apiKey;
    this.tasks = tasks;
    this.server = null;
    this.status = { isConnected: false, accounts: [], completedVideos: [] };
  }

  updateStatus(patch) {
    this.status = { ...this.status, ...patch };
  }

  authorized(req) {
    const given = String(req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    const a = Buffer.from(given);
    const b = Buffer.from(String(this.apiKey()));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  readJson(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(new Error('Body quá lớn (tối đa 40MB)')); req.destroy(); return; }
        body += chunk;
      });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Body không phải JSON hợp lệ')); }
      });
      req.on('error', reject);
    });
  }

  async handle(req, res) {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (req.method === 'GET' && p === '/api/status') return send(200, { success: true, app: 'MuseBatch Studio', version: '2.0.0', status: this.status });
    if (req.method === 'GET' && p === '/api/videos') return send(200, { success: true, videos: this.status.completedVideos || [] });
    if (req.method === 'POST' && p === '/api/render') {
      const data = await this.readJson(req);
      if (!data.prompt) return send(400, { success: false, error: 'Thiếu prompt kịch bản' });
      const task = this.onJobReceived(data);
      return send(200, { success: true, message: 'Đã nhận kịch bản vào hàng đợi render', jobId: task.id });
    }

    if (!p.startsWith('/api/v1/')) return send(404, { success: false, error: 'Endpoint không tồn tại' });
    if (!this.authorized(req)) return send(401, { success: false, error: 'Sai hoặc thiếu API key (xem tab API trong app)' });

    if (p === '/api/v1/tasks') {
      if (req.method === 'GET') {
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500);
        const list = this.tasks.list(url.searchParams.get('status') || '').slice(0, limit).map(publicTask);
        return send(200, { success: true, tasks: list });
      }
      if (req.method === 'POST') {
        const data = await this.readJson(req);
        if (!data.prompt || typeof data.prompt !== 'string') return send(400, { success: false, error: 'Thiếu prompt' });
        const images = (Array.isArray(data.images) ? data.images : []).slice(0, 10).map(i => ({
          imageUrl: /^https?:\/\//.test(i?.imageUrl || '') ? i.imageUrl : '',
          imageBase64: /^data:image\//.test(i?.imageBase64 || '') ? i.imageBase64 : ''
        })).filter(i => i.imageUrl || i.imageBase64);
        const task = this.tasks.submit({
          prompt: data.prompt, images, timeoutMin: data.timeoutMin, label: data.label || '', kind: data.kind,
          expect: data.expect, thread: data.thread || '', ratio: data.ratio || ''
        });
        return send(201, { success: true, task: publicTask(task) });
      }
    }

    const m = /^\/api\/v1\/tasks\/(task_[0-9a-f]+)(\/cancel|\/retry|\/file)?$/.exec(p);
    if (m) {
      const [, id, action = ''] = m;
      const task = this.tasks.get(id);
      if (!task) return send(404, { success: false, error: 'Không có task này' });
      if (req.method === 'GET' && !action) return send(200, { success: true, task: publicTask(task) });
      if (req.method === 'POST' && action === '/cancel') return send(200, { success: true, task: publicTask(this.tasks.cancel(id)) });
      if (req.method === 'POST' && action === '/retry') return send(200, { success: true, task: publicTask(this.tasks.retry(id)) });
      if (req.method === 'DELETE' && !action) return send(200, { success: this.tasks.remove(id) });
      if (req.method === 'GET' && action === '/file') {
        const i = Number(url.searchParams.get('i')) || 0;
        const file = task.files[i];
        if (!file || !fs.existsSync(file)) return send(404, { success: false, error: `Task chưa có file thứ ${i}` });
        const ext = path.extname(file).slice(1).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Content-Length': fs.statSync(file).size,
          'Content-Disposition': `attachment; filename="${id}_${i}.${ext}"`
        });
        return fs.createReadStream(file).pipe(res);
      }
    }
    return send(404, { success: false, error: 'Endpoint không tồn tại' });
  }

  start() {
    this.server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      this.handle(req, res).catch(err => {
        if (res.headersSent) { res.end(); return; }
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    });
    this.server.on('error', e => console.error(`[API] Không mở được cổng ${this.port}:`, e.message));
    return new Promise(resolve => this.server.listen(this.port, '127.0.0.1', () => resolve(this)));
  }

  stop() {
    if (this.server) this.server.close();
  }
}

module.exports = { CrmServer, publicTask };
