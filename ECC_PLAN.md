# KẾ HOẠCH MUSEBATCH — ECC Enhanced
> Electron + CDP + Vanilla JS | ECC Rules Applied Per Sprint

---

## 🔧 ECC Rules áp dụng cho dự án này

Stack là **Vanilla JS (Node.js / Electron)** → áp dụng các rule nhóm:
- `common-coding-style` — Immutability, KISS/DRY/YAGNI, file ≤800 lines, func ≤50 lines
- `common-security` — No hardcoded secrets, validate all input, rate limiting
- `common-patterns` — Repository pattern cho data stores, consistent API response envelope
- `common-testing` — TDD mandatory, 80%+ coverage, AAA pattern
- `web-patterns` — Container/Presentational split cho UI, stale-while-revalidate
- `common-development-workflow` — Conventional commits, review before merge

---

## 1. Kiến trúc tổng thể

```
[Nguồn Task: UI / REST API / LadiPage]
               │
               ▼
    [engine/task-store.js]          ← Repository Pattern (ECC)
               │
               ▼
    [engine/scheduler.js]           ← Pure functions, no side effects (ECC)
               │
               ▼
    [engine/pool.js]                ← Concurrency + anti-ban jitter
          ┌────┴────┐
          ▼         ▼
  [chrome.js]  [muse-page.js]      ← CDP WebSocket + React Fiber
          └────┬────┘
               ▼
          [Muse.ai]
               ▼
    [engine/merge.js]              ← FFmpeg spawn
          ┌────┴────┐
          ▼         ▼
     [UI/Kho]  [facebook-poster]
```

### Directory structure
```
musebatch/
├── package.json
├── electron-builder.yml
├── resources/bin/
│   └── ffmpeg.exe                 # static build — bundled, không cần cài
├── src/
│   ├── main.js                    # IPC router — orchestrate only, no logic
│   ├── preload.js                 # contextBridge — whitelist explicit
│   └── engine/
│       ├── chrome.js              # CDP process manager
│       ├── muse-page.js           # Muse RPC + React Fiber inject
│       ├── task-store.js          # JSON persistence (Repository pattern)
│       ├── accounts.js            # Account pool + settings store
│       ├── scheduler.js           # Pure scheduler (no I/O)
│       ├── pool.js                # Pump loop + anti-ban
│       ├── merge.js               # FFmpeg concat scenes
│       ├── ladi-crawler.js        # HTML scraper
│       ├── product-ai.js          # TTS script generator
│       ├── crm-server.js          # Local HTTP API :48900
│       ├── facebook-poster.js     # FB Graph API Reels
│       └── license-manager.js     # Edition gating
└── ui/
    ├── index.html                 # 9-tab shell
    ├── app.css                    # Dark neon theme
    └── script.js                  # Vanilla JS store + IPC subscribers
```

---

## 2. ECC Global Rules — Bắt buộc xuyên suốt

| Rule | Yêu cầu cụ thể cho MuseBatch |
|---|---|
| **Immutability** | `task-store`: `update(task, patch)` trả về object mới, không mutate. `scheduler.plan()` nhận snapshot, không sửa input |
| **Magic Numbers** | Dùng constants: `MAX_TASKS = 500`, `ANTI_BAN_MIN_MS = 15_000`, `ANTI_BAN_MAX_MS = 20_000`, `CHECK_LOGIN_RETRIES = 20`, `CDP_PORT_BASE = 9222`, `CRM_PORT = 48900` |
| **File size** | Mỗi file ≤800 lines. `muse-page.js` ~186 lines ✓, `product-ai.js` 457 lines → tách `tts-normalizer.js` |
| **Error handling** | Không bao giờ swallow error. Mọi CDP call wrap trong try/catch, log đủ context |
| **No hardcoded secrets** | API key lưu `userData/settings.json`, không commit. `.gitignore` exclude `userData/` |
| **Input validation** | Validate tất cả IPC payload trước khi xử lý. Schema check đơn giản bằng util `validate(schema, data)` |
| **TDD** | Viết test trước mỗi function. Dùng Node.js built-in `node:test` + `assert` |

---

## 3. Sprint 1 — Core CDP Engine & Task Store
**2 ngày | ECC: coding-style + patterns + security**

### Files cần tạo
| File | Vai trò | ECC constraint |
|---|---|---|
| `package.json` | deps: `ws`, `cheerio`, `uuid` | không thêm dep nào khác |
| `src/preload.js` | `contextBridge` whitelist | chỉ expose method được dùng, không expose `ipcRenderer` trực tiếp |
| `src/engine/chrome.js` | CDP process + WS client | func ≤50 lines, extract `CdpConnection` class riêng |
| `src/engine/muse-page.js` | inject `window.__mss`, React Fiber traversal | tách `injectScript` string thành file riêng `bridge-script.js` nếu >50 lines |
| `src/engine/task-store.js` | JSON persistence | Repository pattern: `findAll`, `findById`, `create`, `update`, `remove` |
| `src/main.js` | IPC router | chỉ route IPC → engine, không chứa business logic |
| `tests/task-store.test.js` | Unit test | TDD — viết test trước |

### ECC Coding rules Sprint 1

```js
// ✅ ĐÚNG — Immutable update
function updateTask(store, id, patch) {
  return store.tasks.map(t => t.id === id ? { ...t, ...patch } : t)
}

// ❌ SAI — mutate in place
function updateTask(store, id, patch) {
  const task = store.tasks.find(t => t.id === id)
  Object.assign(task, patch)  // mutates!
}

// ✅ ĐÚNG — Named constants
const MAX_TASKS = 500
const TASK_IMAGES_DIR = 'task-images'

// ❌ SAI — magic numbers
if (tasks.length > 500) purge()

// ✅ ĐÚNG — validate IPC payload
ipcMain.handle('task:create', (_, payload) => {
  const err = validate({ prompt: 'string', ratio: 'string' }, payload)
  if (err) return { ok: false, error: err }
  return taskStore.create(payload)
})
```

### IPC Channels Sprint 1
| Channel | Payload | Response |
|---|---|---|
| `task:create` | `{ prompt, images?, ratio, kind }` | `{ ok, taskId? , error? }` |
| `task:list` | `{ status? }` | `Task[]` |
| `task:cancel` | `{ taskId }` | `{ ok, error? }` |
| `engine:test-chrome` | `{ accountId }` | `{ ok, error? }` |

> **ECC API envelope**: Mọi response đều có `ok: boolean` + optional `error: string` — không bao giờ throw raw error lên renderer.

### Acceptance Criteria Sprint 1
- [ ] `node:test` chạy pass 100% `tests/task-store.test.js` (coverage ≥80%)
- [ ] Chrome mở được với profile riêng, CDP WebSocket kết nối thành công
- [ ] Gửi prompt lên Muse.ai qua CDP không cần click tay
- [ ] `tasks.json` ghi atomic (tmp → rename), không corrupt khi kill process

---

## 4. Sprint 2 — Multi-Account, Scheduler & Pool
**2 ngày | ECC: patterns (pure functions) + security (proxy isolation)**

### Files cần tạo
| File | Vai trò | ECC constraint |
|---|---|---|
| `src/engine/accounts.js` | Account + Settings store | Repository pattern, default account không xóa được |
| `src/engine/scheduler.js` | Pure scheduling logic | **Không có I/O, không có side effects** — chỉ nhận data, trả data |
| `src/engine/pool.js` | Concurrency pump | jitter delay dùng constant, extract `antiBanJitter()` riêng |
| `tests/scheduler.test.js` | Unit test | TDD, test pure functions dễ — không cần mock |

### ECC Pure Function rule cho scheduler

```js
// ✅ ĐÚNG — Pure, testable, no I/O
function plan({ tasks, accounts, settings, runningTasks, now }) {
  // chỉ tính toán, không đọc file, không gọi network
  return pairs // [{ task, accountId }]
}

// ❌ SAI — I/O trong scheduler
async function plan() {
  const tasks = await fs.readFile('tasks.json')  // NO!
  const accounts = await db.query(...)            // NO!
}
```

### Constants cần định nghĩa (`src/engine/constants.js`)
```js
export const MAX_TASKS = 500
export const MAX_ACCOUNTS = 10
export const DEFAULT_THREADS = 2
export const ANTI_BAN_MIN_MS = 15_000
export const ANTI_BAN_MAX_MS = 20_000
export const CHECK_LOGIN_RETRIES = 20
export const CHECK_LOGIN_INTERVAL_MS = 3_000
export const PUMP_INTERVAL_MS = 3_000
export const CDP_PORT_BASE = 9222
export const CRM_PORT = 48900
export const CHUNK_SIZE_BYTES = 2 * 1024 * 1024  // 2MB
```

### Security rules Sprint 2
- Proxy config lưu `userData/accounts.json` — không log proxy credentials ra console
- Mỗi account profile tại `userData/profiles/<accountId>/` — isolate hoàn toàn
- `proxyAuto` flag: nếu true, validate proxy trước khi dùng (check reachable)

### IPC Channels Sprint 2
| Channel | Payload | Response |
|---|---|---|
| `account:list` | — | `AccountView[]` |
| `account:save` | `AccountConfig` | `{ ok, error? }` |
| `account:delete` | `{ id }` | `{ ok, error? }` |
| `account:open-browser` | `{ id }` | `{ ok, error? }` |
| `account:refresh-quota` | `{ id }` | `{ ok, quota?, error? }` |
| `settings:get` | — | `Settings` |
| `settings:save` | `Partial<Settings>` | `{ ok, error? }` |

### Acceptance Criteria Sprint 2
- [ ] `scheduler.test.js` pass: test 6 cases (resume sessionId, pin thread, rotate quota, empty accounts, all busy, keepGoing off)
- [ ] 3 tài khoản với 3 proxy khác nhau mở đúng 3 port CDP riêng
- [ ] Khoảng cách giữa 2 submit cùng account luôn 15–20s (test bằng mock timer)
- [ ] Tắt/bật app: queue + account state khôi phục nguyên vẹn

---

## 5. Sprint 3 — Crawler, TTS Script Generator & FFmpeg Merge
**3 ngày | ECC: error-handling + file size + testing**

### Files cần tạo
| File | Vai trò | ECC constraint |
|---|---|---|
| `src/engine/ladi-crawler.js` | HTML scraper | timeout 15s, validate URL trước khi fetch |
| `src/engine/product-ai.js` | Script generator + TTS normalizer | Tách `tts-normalizer.js` nếu >200 lines |
| `src/engine/merge.js` | FFmpeg spawn | Wrap trong Promise, clean up temp files trong `finally` |
| `tests/product-ai.test.js` | TDS normalizer tests | Test `speak()` với VND amounts, phone numbers, emoji |
| `tests/ladi-crawler.test.js` | Crawler tests | Mock HTTP responses |

### ECC Error Handling — merge.js
```js
// ✅ ĐÚNG — cleanup trong finally, không swallow error
async function mergeScenes(videoPaths, outputPath) {
  const concatFile = outputPath + '.concat.txt'
  try {
    await fs.writeFile(concatFile, videoPaths.map(p => `file '${p}'`).join('\n'))
    await spawnFfmpeg(['-f', 'concat', '-safe', '0', '-i', concatFile,
      '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', outputPath])
  } finally {
    await fs.unlink(concatFile).catch(() => {})  // cleanup, ignore if already gone
  }
}

// ❌ SAI — leak temp file on error
async function mergeScenes(videoPaths, outputPath) {
  const concatFile = outputPath + '.concat.txt'
  await fs.writeFile(concatFile, ...)
  await spawnFfmpeg(...)               // throws → concatFile never deleted
  await fs.unlink(concatFile)
}
```

### TTS Budget constants
```js
const TTS_WORDS_PER_SEC = 4.6
const SCENE_DURATION_SEC = 10
const TTS_MIN_WORDS = 40   // 10s * 4.6 - 6 buffer
const TTS_MAX_WORDS = 46   // 10s * 4.6
const SCENE_COUNT = 3
```

### IPC Channels Sprint 3
| Channel | Payload | Response |
|---|---|---|
| `crawler:scrape` | `{ url }` | `{ ok, title?, price?, images?, text?, error? }` |
| `product-ai:gen` | `{ productInfo, angle, style }` | `{ ok, scenes?, error? }` |
| `video:merge-test` | `{ videoPaths }` | `{ ok, outputPath?, error? }` |

### Acceptance Criteria Sprint 3
- [ ] `ladi-crawler.test.js` mock 5 trang: LadiPage chuẩn, redirect, timeout, HTTPS, broken HTML
- [ ] `speak('199.000đ')` → `'một trăm chín mươi chín nghìn đồng'` — test case pass
- [ ] FFmpeg ghép 3 video 10s → 1 video 30s không corrupt (checksum output)
- [ ] Temp file `concat.txt` được xóa kể cả khi FFmpeg thất bại

---

## 6. Sprint 4 — CRM API, Facebook Reels & License
**2 ngày | ECC: security (API key, rate limiting) + common-patterns (API envelope)**

### Files cần tạo
| File | Vai trò | ECC constraint |
|---|---|---|
| `src/engine/crm-server.js` | HTTP server :48900 | Rate limiting, auth middleware tách riêng |
| `src/engine/facebook-poster.js` | FB Graph API | Token không log, retry với backoff |
| `src/engine/license-manager.js` | Edition gating | machineId từ hardware, không hardcode |
| `tests/crm-server.test.js` | API endpoint tests | Test auth, 401, 404, 200 cases |

### ECC Security rules Sprint 4

```js
// ✅ ĐÚNG — API key từ settings, không hardcode
function createAuthMiddleware(getApiKey) {
  return (req, res, next) => {
    const key = req.headers['x-api-key'] ?? extractBearer(req.headers.authorization)
    if (!key || key !== getApiKey()) {
      return res.writeHead(401).end(JSON.stringify({ ok: false, error: 'Unauthorized' }))
    }
    next()
  }
}

// ❌ SAI — hardcoded secret
const API_KEY = 'my-secret-key-123'  // NO!

// ✅ ĐÚNG — consistent API envelope
function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: status < 400, ...data }))
}

// ✅ ĐÚNG — rate limiting đơn giản
const rateLimiter = new Map()  // ip → { count, resetAt }
```

### ECC API Endpoint Contract (crm-server)
```
POST   /api/v1/tasks          → { ok, taskId }
GET    /api/v1/tasks?status=  → { ok, tasks: Task[] }
GET    /api/v1/tasks/:id      → { ok, task }
POST   /api/v1/tasks/:id/cancel → { ok }
POST   /api/v1/tasks/:id/retry  → { ok }
GET    /api/v1/tasks/:id/file?i=0 → binary stream (video/mp4)
```
> **Rule**: Mọi JSON response đều wrap trong `{ ok: boolean, ...payload }` — không trả raw object.

### IPC Channels Sprint 4
| Channel | Payload | Response |
|---|---|---|
| `crm:get-status` | — | `{ ok, running, port, apiKey }` |
| `crm:toggle` | `{ enable }` | `{ ok, running, error? }` |
| `fb:get-pages` | `{ userToken }` | `{ ok, pages?, error? }` |
| `fb:post-reels` | `{ pageId, pageToken, videoPath, caption }` | `{ ok, videoId?, error? }` |
| `license:check` | `{ key }` | `{ ok, valid, edition?, expiresAt?, error? }` |

### Acceptance Criteria Sprint 4
- [ ] `crm-server.test.js`: 401 khi không có API key, 404 task không tồn tại, 200 tạo task thành công
- [ ] Token Facebook không xuất hiện trong bất kỳ log file nào
- [ ] Edition `customer` ẩn tab CRM — test bằng license mock
- [ ] Gọi `POST /api/v1/tasks` bằng cURL tạo được task vào queue

---

## 7. Sprint 5 — UI Neon Dark & Packaging
**3 ngày | ECC: web-patterns (container/presentational) + make-interfaces-feel-better**

### Files cần tạo
| File | Vai trò | ECC constraint |
|---|---|---|
| `ui/index.html` | 9-tab shell | Semantic HTML, ARIA labels cho buttons |
| `ui/app.css` | Dark neon theme | CSS Custom Properties, không hardcode màu inline |
| `ui/script.js` | JS controller | Container/Presentational split, store pattern |
| `electron-builder.yml` | NSIS packaging | `extraResources` include `resources/bin/` |

### ECC Web Patterns — UI Architecture

```js
// ✅ ĐÚNG — Store (Container) tách khỏi render (Presentational)
const store = {
  tasks: [],
  listeners: new Set(),
  setState(patch) {
    Object.assign(this, patch)               // chỉ store được mutate
    this.listeners.forEach(fn => fn(this))
  },
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
}

// Presentational — pure render từ state
function renderTaskCard(task) {
  return `<div class="task-card" data-id="${task.id}">
    <span class="status status--${task.status}">${task.status}</span>
    ...
  </div>`
}

// ❌ SAI — DOM query trong business logic
function cancelTask(id) {
  document.querySelector(`[data-id="${id}"]`).style.display = 'none'  // NO!
  window.api.invoke('task:cancel', { taskId: id })
}
```

### CSS Custom Properties (ECC — no magic colors)
```css
:root {
  --bg-base: #0e1117;
  --bg-card: #1a1f2c;
  --accent-cyan: #00f2fe;
  --accent-blue: #4facfe;
  --accent-pink: #ff007f;
  --text-primary: #e2e8f0;
  --text-muted: #64748b;
  --radius-card: 12px;
  --transition-fast: 150ms ease;
}
```

### 9 Tabs
| # | Tab | Container | Presentational |
|---|---|---|---|
| 1 | Text → Video | fetch quota, submit task | form + progress card |
| 2 | Image → Video | handle drop/paste, upload | drop zone + preview |
| 3 | LadiPage Studio | scrape → gen script → submit | URL input + script preview |
| 4 | Kho Video | list completed tasks | video grid + player |
| 5 | Đăng Facebook | fetch pages, publish | page selector + caption |
| 6 | CRM / API Server | toggle server, gen key | status + log viewer |
| 7 | Tài khoản | CRUD accounts | account cards + quota bar |
| 8 | Cài đặt | read/write settings | form fields |
| 9 | Studio AI | workspace session | editor + output |

### Acceptance Criteria Sprint 5
- [ ] App khởi động <1.5s (đo bằng `performance.now()` trong `did-finish-load`)
- [ ] Chuyển tab tức thì, không re-render toàn bộ DOM
- [ ] `.exe` NSIS installer cài được trên Windows sạch (không cần Node.js, FFmpeg)
- [ ] E2E flow: LadiPage URL → script → render 2 accounts → merge → MP4

---

## 8. Bảng IPC tổng hợp (19 channels)

| Channel | Hướng | Payload | Response |
|---|---|---|---|
| `task:create` | R→M | `{ prompt, images?, ratio, kind, project? }` | `{ ok, taskId?, error? }` |
| `task:list` | R→M | `{ status? }` | `{ ok, tasks }` |
| `task:cancel` | R→M | `{ taskId }` | `{ ok, error? }` |
| `task:retry` | R→M | `{ taskId }` | `{ ok, error? }` |
| `task:delete` | R→M | `{ taskId }` | `{ ok, error? }` |
| `task:status-changed` | M→R push | — | `{ taskId, status, scene?, error? }` |
| `account:list` | R→M | — | `{ ok, accounts }` |
| `account:save` | R→M | `AccountConfig` | `{ ok, error? }` |
| `account:delete` | R→M | `{ id }` | `{ ok, error? }` |
| `account:open-browser` | R→M | `{ id }` | `{ ok, error? }` |
| `account:refresh-quota` | R→M | `{ id }` | `{ ok, quota?, error? }` |
| `settings:get` | R→M | — | `{ ok, settings }` |
| `settings:save` | R→M | `Partial<Settings>` | `{ ok, error? }` |
| `crawler:scrape` | R→M | `{ url }` | `{ ok, data?, error? }` |
| `product-ai:gen` | R→M | `{ productInfo, angle }` | `{ ok, scenes?, error? }` |
| `video:open-folder` | R→M | `{ filePath }` | `{ ok, error? }` |
| `crm:get-status` | R→M | — | `{ ok, running, port, apiKey }` |
| `crm:toggle` | R→M | `{ enable }` | `{ ok, running, error? }` |
| `fb:get-pages` | R→M | `{ userToken }` | `{ ok, pages?, error? }` |
| `fb:post-reels` | R→M | `{ pageId, pageToken, videoPath, caption }` | `{ ok, videoId?, error? }` |
| `license:check` | R→M | `{ key }` | `{ ok, valid, edition?, error? }` |

---

## 9. Testing Strategy (ECC: 80% coverage)

```
tests/
├── task-store.test.js      # create, update immutable, purge at 500, atomic write
├── scheduler.test.js       # 6 plan() cases — pure, no mocks needed
├── product-ai.test.js      # speak() normalizer, fit() word budget
├── ladi-crawler.test.js    # mock HTTP — redirect, timeout, broken HTML
└── crm-server.test.js      # auth, CRUD endpoints, file streaming
```

**Chạy test:**
```bash
node --test tests/*.test.js
```

> **ECC TDD flow**: Viết test file trước → `node --test` → RED → implement → GREEN → refactor

---

## 10. Risks & Mitigations (ECC-aware)

| Risk | Mitigation | ECC Rule |
|---|---|---|
| Muse.ai React DOM thay đổi | Dùng `memoizedProps` traversal thay class selector | `common-coding-style`: semantic over structural |
| CAPTCHA / account ban | `antiBanJitter` constant 15–20s, proxy per account | `common-security`: rate limiting |
| FFmpeg compat Windows | Static build + `-pix_fmt yuv420p` | `common-patterns`: vendor bundled tools |
| Memory leak nhiều ngày | Đóng CDP page sau task chain, FIFO purge 500 tasks | `common-coding-style`: resource cleanup |
| API key lộ | Store trong `userData/settings.json`, exclude `userData/` khỏi git | `common-security`: no hardcoded secrets |

---

## 11. Timeline

```
Tuần 1:  Sprint 1 (2 ngày) → Sprint 2 (2 ngày) → Sprint 3 ngày 1
Tuần 2:  Sprint 3 (ngày 2-3) → Sprint 4 (2 ngày) → Sprint 5 ngày 1
Tuần 3:  Sprint 5 (ngày 2-3) → QA + polish

Tổng: 10–12 ngày làm việc
```

> **Bắt đầu Sprint 1**: Tạo `src/engine/constants.js` → `tests/task-store.test.js` → `src/engine/task-store.js`
