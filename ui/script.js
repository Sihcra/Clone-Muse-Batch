'use strict'
// script.js — Vanilla JS UI Controller with IPC integration
// ECC Rule: Container/Presentational split, real-time push events

const state = {
  activeTab: 'text-video',
  tasks: [],
  accounts: [],
  crmRunning: false,
}

// ── Tab Navigation ─────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'))
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'))

    el.classList.add('active')
    const tabId = el.getAttribute('data-tab')
    state.activeTab = tabId
    document.getElementById(tabId)?.classList.add('active')

    if (tabId === 'videos') loadTasks()
    if (tabId === 'accounts') loadAccounts()
    if (tabId === 'crm') loadCrmStatus()
  })
})

// ── Text to Video ──────────────────────────────────────────────────────────
document.getElementById('btnCreateTextVideo')?.addEventListener('click', async () => {
  const prompt = document.getElementById('tvPrompt').value.trim()
  const ratio = document.getElementById('tvRatio').value
  if (!prompt) return alert('Vui lòng nhập prompt!')

  const res = await window.api.invoke('task:create', {
    prompt,
    ratio,
    kind: 'video',
  })

  if (res.ok) {
    alert('Đã thêm task vào hàng đợi!')
    document.getElementById('tvPrompt').value = ''
    loadTasks()
  } else {
    alert('Lỗi: ' + res.error)
  }
})

// ── Image to Video ─────────────────────────────────────────────────────────
document.getElementById('btnCreateImageVideo')?.addEventListener('click', async () => {
  const image = document.getElementById('ivImage').value.trim()
  const prompt = document.getElementById('ivPrompt').value.trim()
  if (!image || !prompt) return alert('Vui lòng nhập link ảnh và prompt chuyển động!')

  const res = await window.api.invoke('task:create', {
    prompt,
    images: [image],
    ratio: '9:16',
    kind: 'video',
  })

  if (res.ok) {
    alert('Đã tạo task video từ ảnh!')
    document.getElementById('ivImage').value = ''
    document.getElementById('ivPrompt').value = ''
    loadTasks()
  } else {
    alert('Lỗi: ' + res.error)
  }
})

// ── LadiPage Crawler & Auto Script ─────────────────────────────────────────
document.getElementById('btnCrawlLadi')?.addEventListener('click', async () => {
  const url = document.getElementById('lpUrl').value.trim()
  if (!url) return alert('Vui lòng dán link landing page!')

  const btn = document.getElementById('btnCrawlLadi')
  btn.textContent = 'Đang quét...'
  btn.disabled = true

  const res = await window.api.invoke('crawler:scrape', { url })
  btn.textContent = '1. Quét thông tin trang'
  btn.disabled = false

  if (res.ok && res.data) {
    document.getElementById('lpResult').style.display = 'block'
    document.getElementById('lpTitle').value = res.data.title || ''
    document.getElementById('lpPrice').value = res.data.price || ''
  } else {
    alert('Không thể cào thông tin trang: ' + (res.error || 'Unknown error'))
  }
})

document.getElementById('btnGenLadiScript')?.addEventListener('click', async () => {
  const title = document.getElementById('lpTitle').value.trim()
  const price = document.getElementById('lpPrice').value.trim()

  const res = await window.api.invoke('product-ai:gen', { title, price })
  if (res.ok && res.scenes) {
    // Submit 3 scenes into task store
    for (const scene of res.scenes) {
      await window.api.invoke('task:create', {
        prompt: scene.prompt,
        ratio: '9:16',
        kind: 'video',
      })
    }
    alert(`Đã tự động tạo ${res.scenes.length} cảnh vào hàng đợi!`)
    loadTasks()
  } else {
    alert('Lỗi sinh kịch bản: ' + res.error)
  }
})

// ── Tasks Queue View ───────────────────────────────────────────────────────
async function loadTasks() {
  const container = document.getElementById('taskList')
  const res = await window.api.invoke('task:list')
  if (!res.ok) return

  state.tasks = res.tasks || []
  if (state.tasks.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted);">Chưa có task nào trong hàng đợi.</p>'
    return
  }

  container.innerHTML = state.tasks.slice().reverse().map(t => `
    <div class="task-item">
      <div class="task-info">
        <span class="task-prompt">${escapeHtml(t.prompt)}</span>
        <span class="task-meta">ID: ${t.id.slice(0, 8)}... | Tỷ lệ: ${t.ratio} | Tạo lúc: ${new Date(t.createdAt).toLocaleTimeString()}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span class="badge badge-${t.status}">${t.status}</span>
        ${t.status === 'queued' || t.status === 'processing' ? `
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="cancelTask('${t.id}')">Hủy</button>
        ` : ''}
      </div>
    </div>
  `).join('')
}

document.getElementById('btnRefreshTasks')?.addEventListener('click', loadTasks)

window.cancelTask = async (id) => {
  await window.api.invoke('task:cancel', { taskId: id })
  loadTasks()
}

// ── Accounts View ──────────────────────────────────────────────────────────
async function loadAccounts() {
  const container = document.getElementById('accountsList')
  const res = await window.api.invoke('account:list')
  if (!res.ok) return

  state.accounts = res.accounts || []
  container.innerHTML = state.accounts.map(acc => `
    <div class="task-item">
      <div class="task-info">
        <span class="task-prompt">${escapeHtml(acc.name)} (${acc.id})</span>
        <span class="task-meta">Trạng thái: ${acc.loggedIn ? '✅ Đã đăng nhập' : '❌ Chưa đăng nhập'} | Proxy: ${acc.proxy || 'Trực tiếp'}</span>
      </div>
      <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="openAccountBrowser('${acc.id}')">Mở Chrome</button>
    </div>
  `).join('')
}

window.openAccountBrowser = async (id) => {
  await window.api.invoke('account:open-browser', { id })
}

// ── CRM Controls ───────────────────────────────────────────────────────────
async function loadCrmStatus() {
  const res = await window.api.invoke('crm:get-status')
  if (!res.ok) return

  state.crmRunning = res.running
  const badge = document.getElementById('crmStatusBadge')
  const btn = document.getElementById('btnToggleCrm')
  document.getElementById('crmApiKey').value = res.apiKey || ''

  if (res.running) {
    badge.className = 'badge badge-succeeded'
    badge.textContent = `ĐANG CHẠY (PORT ${res.port})`
    btn.textContent = 'Tắt CRM Server'
  } else {
    badge.className = 'badge badge-queued'
    badge.textContent = 'ĐANG TẮT'
    btn.textContent = 'Bật CRM Server'
  }
}

document.getElementById('btnToggleCrm')?.addEventListener('click', async () => {
  const enable = !state.crmRunning
  const res = await window.api.invoke('crm:toggle', { enable })
  if (res.ok) loadCrmStatus()
})

// ── Real-time Task Push Events ─────────────────────────────────────────────
if (window.api?.on) {
  window.api.on('task:status-changed', () => {
    if (state.activeTab === 'videos') loadTasks()
  })
}

// ── License check ──────────────────────────────────────────────────────────
async function checkLicense() {
  const res = await window.api.invoke('license:check', {})
  const badge = document.getElementById('licenseBadge')
  if (badge && res.ok) {
    badge.className = res.edition === 'pro' ? 'badge badge-succeeded' : 'badge badge-queued'
    badge.textContent = `EDITION: ${res.edition.toUpperCase()} (${res.valid ? 'ACTIVE' : 'TRIAL'})`
  }
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag))
}

// Initial Boot
checkLicense()
loadTasks()
