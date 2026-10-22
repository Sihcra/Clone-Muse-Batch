'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'musebatch-test-'));

// Store giả trong bộ nhớ, cùng giao diện list/get/update như TaskStore/AccountStore
function memTasks(list) {
  const tasks = list.map(t => ({ status: 'queued', attempts: 0, images: [], files: [], createdAt: 0, sessionId: '', accountId: '', ...t }));
  return {
    list: () => tasks,
    get: id => tasks.find(t => t.id === id),
    update(id, patch) { const t = tasks.find(x => x.id === id); Object.assign(t, patch); return t; }
  };
}

function memAccounts(list, settings = {}) {
  const accounts = list.map(a => ({ enabled: true, threads: 1, loggedIn: true, quota: null, lastUsedAt: 0, name: a.id, ...a }));
  return {
    settings: { maxAccounts: 5, totalThreads: 5, mode: 'rotate', useTopup: true, keepGoing: false, ...settings },
    list: () => accounts,
    get: id => accounts.find(a => a.id === id),
    update(id, patch) { const a = accounts.find(x => x.id === id); if (a) Object.assign(a, patch); return a; }
  };
}

const tick = () => new Promise(r => setImmediate(r));

module.exports = { tmpDir, memTasks, memAccounts, tick };
