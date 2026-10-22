/**
 * API & TÍCH HỢP — API key, ví dụ curl, kiểm tra API, nhật ký lệnh từ Content CRM.
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, toast } = window.App;
  if (!api) return;

  const API_BASE = 'http://127.0.0.1:48900/api/v1';
  const keyInput = $('api-key');
  const testResult = $('api-test-result');

  async function loadKey(regenerate = false) {
    keyInput.value = await api.getApiKey(regenerate);
    $('api-curl').textContent =
`# Ví dụ (thay <KEY> bằng key ở trên)
curl -X POST ${API_BASE}/tasks \\
  -H "Authorization: Bearer <KEY>" -H "Content-Type: application/json" \\
  -d '{"prompt":"Tạo video chân thực 10s, cận cảnh ly cà phê bốc khói","label":"test"}'

curl ${API_BASE}/tasks/<TASK_ID> -H "Authorization: Bearer <KEY>"
curl -o video.mp4 ${API_BASE}/tasks/<TASK_ID>/file -H "Authorization: Bearer <KEY>"`;
  }

  $('btn-api-key-show').addEventListener('click', e => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Ẩn' : 'Hiện';
  });
  $('btn-api-key-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(keyInput.value);
    toast('Đã copy API key.', 'ok');
  });
  $('btn-api-key-new').addEventListener('click', async () => {
    if (!confirm('Đổi API key? Các hệ thống đang dùng key cũ sẽ bị từ chối cho tới khi cập nhật key mới.')) return;
    await loadKey(true);
    toast('Đã đổi API key.', 'ok');
  });
  $('btn-api-test').addEventListener('click', async () => {
    testResult.hidden = false;
    testResult.textContent = 'GET /api/v1/tasks?limit=1 ...';
    try {
      const r = await fetch(`${API_BASE}/tasks?limit=1`, { headers: { Authorization: `Bearer ${keyInput.value}` } });
      testResult.textContent = `HTTP ${r.status}\n` + JSON.stringify(await r.json(), null, 2);
    } catch (err) {
      testResult.textContent = 'Lỗi gọi API: ' + err.message;
    }
  });

  const logs = $('crm-logs-list');
  api.onCrmJobReceived(job => {
    logs.querySelector('.queue-empty')?.remove();
    const el = document.createElement('div');
    el.className = 'log-item';
    el.innerHTML = `<div class="row-between"><strong>${escapeHtml(job.topicId || 'Kịch bản')}</strong><span class="muted small">${new Date().toLocaleTimeString('vi-VN')}</span></div>
      <p>${escapeHtml(job.prompt)}</p>`;
    logs.prepend(el);
  });

  loadKey();
})();
