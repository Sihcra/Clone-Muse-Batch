'use strict';
/**
 * SCHEDULER — chọn task nào chạy trên tài khoản nào. Hàm thuần: không I/O, không Chrome.
 * 1. Task dở (đã gửi, có sessionId) chỉ dò tiếp trên đúng tài khoản đã gửi.
 * 2. Task làm tiếp chat cũ (thread + pin) chờ đúng tài khoản giữ chat; tài khoản đó hết dùng được thì để TK khác làm chat mới.
 * 3. Task chờ: chia cho tài khoản dùng được, ít việc nhất → còn nhiều hạn mức nhất → lâu chưa dùng nhất
 *    (chế độ "Lần lượt": giữ thứ tự danh sách tài khoản).
 */

// Hết hạn mức tuần. Không có trạng thái rõ ràng lúc hết thật → bắt theo chữ; SUFFICIENT/LOW coi là còn.
function weeklyOut(q) {
  if (!q) return false;
  return q.pct >= 100 || /EXHAUST|EXCEED|DEPLET|LIMIT|OUT|BLOCK/i.test(q.status || '');
}

// Thời điểm hết nghỉ (ms) nếu tài khoản đang phải nghỉ vì hết hạn mức; 0 = không nghỉ.
function pausedUntil(acc, settings, now) {
  const q = acc.quota;
  if (!weeklyOut(q) || settings.keepGoing) return 0;
  if (q.resetsAt && q.resetsAt <= now) return 0; // đã qua lúc đặt lại, số cũ hết hiệu lực
  if (settings.useTopup && q.topupLeft > 0) return 0;
  return q.resetsAt || Infinity;
}

const usable = (acc, settings, now) => acc.enabled && acc.loggedIn !== false && !pausedUntil(acc, settings, now);

function plan({ tasks, accounts, settings, running, now }) {
  const busy = new Map(accounts.map(a => [a.id, 0]));
  for (const id of running.values()) busy.set(id, (busy.get(id) || 0) + 1);
  let total = running.size;
  const out = [];

  const canTake = acc => {
    const b = busy.get(acc.id) || 0;
    const activeAccounts = [...busy.values()].filter(n => n > 0).length;
    return b < acc.threads && total < settings.totalThreads && (b > 0 || activeAccounts < settings.maxAccounts);
  };
  const take = (task, acc) => {
    busy.set(acc.id, (busy.get(acc.id) || 0) + 1);
    total++;
    out.push({ taskId: task.id, accountId: acc.id });
  };

  const free = tasks.filter(t => !running.has(t.id));

  for (const t of free.filter(t => t.status === 'processing' && t.sessionId)) {
    const acc = accounts.find(a => a.id === (t.accountId || 'default'));
    if (acc && acc.enabled && acc.loggedIn !== false && canTake(acc)) take(t, acc);
  }

  const queued = free.filter(t => t.status === 'queued' && !t.held).sort((a, b) => a.createdAt - b.createdAt);
  for (const t of queued) {
    let pool = accounts.filter(a => usable(a, settings, now) && canTake(a));
    const pin = t.thread && accounts.find(a => a.id === t.pin);
    if (pin && usable(pin, settings, now)) pool = pool.filter(a => a === pin);
    if (!pool.length) {
      if (pin) continue; // tài khoản giữ chat đang bận → task khác vẫn được chia
      break;
    }
    if (settings.mode !== 'sequential') {
      pool = pool.slice().sort((a, b) =>
        busy.get(a.id) - busy.get(b.id) ||
        (a.quota?.pct ?? 0) - (b.quota?.pct ?? 0) ||
        (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
    }
    take(t, pool[0]);
  }
  return out;
}

module.exports = { weeklyOut, pausedUntil, usable, plan };
