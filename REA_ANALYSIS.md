# BÁO CÁO PHÂN TÍCH KỸ THUẬT TOÀN DIỆN (REA REVERSE ENGINEERING)
> Đối tượng phân tích: Ứng dụng Electron Vanh / Muse Studio Pro
> Vị trí mã nguồn gốc: `c:\Users\ADMIN\Downloads\Vanh_Tool_Setup\Vanh\resources\app\`
> Đặc điểm: Electron 26, Node.js, Vanilla JavaScript ES2022 (Mã nguồn hoàn toàn không bị mã hóa/obfuscate).

---

## 1. Kiến trúc tổng thể hệ thống

Ứng dụng hoạt động theo cơ chế **Automation qua Chrome DevTools Protocol (CDP)** kết hợp với **Worker Pool song song đa tài khoản**:

```
[Nguồn Task: UI / Local REST API / LadiPage Auto]
                       │
                       ▼
            [engine/task-store.js] (tasks.json, atomic write)
                       │
                       ▼
           [engine/scheduler.js] (matchmaking pure logic: task <-> account)
                       │
                       ▼
             [engine/pool.js] (concurrency pump, anti-ban jitter)
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
[engine/chrome.js]             [engine/muse-page.js]
(CDP WS connection)            (React fiber traversal & RPC injection)
       │                               │
       └───────────────┬───────────────┘
                       ▼
                  [Muse.ai]
                       │
                       ▼ (Download chunks 2MB base64)
            [engine/merge.js] (FFmpeg concatenate scenes)
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
[Thư viện Video / UI]          [engine/facebook-poster.js]
                                   (FB Graph API -> Reels)
```

---

## 2. Chi tiết 14 Module Engine (`resources/app/engine/`)

### 2.1 `chrome.js` (232 dòng) — Quản lý Chrome & CDP
- **Tìm kiếm Chrome**: Quét registry và các đường dẫn chuẩn trong `Program Files`, `Program Files (x86)`, `LocalAppData`.
- **Khởi chạy độc lập**: Mỗi tài khoản mở một tiến trình Chrome thật riêng biệt với các tham số:
  ```bash
  --remote-debugging-port=${port}
  --user-data-dir="${profilePath}"
  --no-first-run
  --no-default-browser-check
  --disable-background-networking
  --disable-sync
  https://muse.ai
  ```
  Nếu có proxy: thêm tham số `--proxy-server=${proxy}`.
- **WebSocket CDP**: Kết nối tới `http://127.0.0.1:${port}/json` để lấy `webSocketDebuggerUrl`, sau đó kết nối WebSocket thuần (`ws`) để gửi lệnh CDP:
  - `Runtime.enable`, `Page.enable`
  - `Runtime.evaluate`: Chạy script trực tiếp trong trang với `awaitPromise: true`.

### 2.2 `muse-page.js` (186 dòng) — Tự động hóa Muse.ai & Fiber Injection
- **Cơ chế React Fiber Traversal (`window.__mss`)**:
  - Không dựa vào CSS class tĩnh (vì dễ bị Next.js đổi hash khi build).
  - Tìm node gốc `#root` hoặc `[data-reactroot]`, đọc thuộc tính `__reactFiber$...`.
  - Duyệt cây Fiber tìm node có `memoizedProps.value.sendMessage` và `ensureActiveChatSendReady`.
  - Kích hoạt gửi prompt:
    ```javascript
    const payload = { text, attachments };
    if (threadId) payload.targetRoute = { kind: 'thread', sessionId: threadId };
    sendMessage(payload);
    ```
- **Kiểm tra đăng nhập**: Đọc session qua cookie bằng `fetch('/api/session')`.
- **Đọc trạng thái & URL video**: Gọi RPC nội bộ của Muse qua `POST /api/rpc`:
  - `method: 'sessions.list'` → Kiểm tra tiến độ và trạng thái task.
  - `method: 'chat.history'` → Trích xuất danh sách link video/ảnh hoàn thành.
  - `method: 'chat.cancel'` → Hủy session đang render.
- **Tải file nhị phân lớn**: Tải file qua RPC `fs.raw` theo từng chunk 2MB (base64) để tránh tràn RAM, ghép dần vào đĩa.
- **Đọc Quota**: Quét các file JS của Next.js để tìm Server Action ID gọi endpoint subscription quota.

### 2.3 `task-store.js` (118 dòng) — Quản lý & Lưu trữ Task
- **Lưu trữ**: `userData/tasks.json`. Ảnh đính kèm lưu riêng ở `userData/task-images/` (tránh phình to JSON).
- **Cơ chế ghi an toàn (Atomic Write)**: Ghi ra file `.tmp` trước, sau đó dùng `fs.renameSync` đè lên file chính thức để tránh hỏng dữ liệu khi tắt app đột ngột.
- **Giới hạn bộ nhớ**: `MAX_TASKS = 500`. Áp dụng cơ chế FIFO dọn dẹp task cũ khi vượt quá 500.
- **Data Schema chuẩn**:
  ```json
  {
    "id": "uuid-v4",
    "source": "ui | api | ladipage",
    "label": "",
    "prompt": "",
    "images": [],
    "kind": "video | image",
    "ratio": "9:16 | 16:9",
    "sessionId": null,
    "accountId": null,
    "thread": null,
    "pin": false,
    "status": "queued | processing | succeeded | failed | cancelled",
    "attempts": 0,
    "createdAt": "ISO-Date",
    "files": [],
    "error": null
  }
  ```

### 2.4 `accounts.js` (95 dòng) — Quản lý Đa tài khoản & Cấu hình
- **Lưu trữ**: `userData/accounts.json` và `userData/settings.json`.
- **Cấu hình mặc định**:
  ```json
  {
    "maxAccounts": 2,
    "totalThreads": 2,
    "mode": "rotate",
    "useTopup": true,
    "keepGoing": false,
    "proxies": "",
    "usePool": false
  }
  ```
- Tài khoản `default` luôn tồn tại và không được phép xóa tài khoản cuối cùng.
- Quản lý proxy riêng cho từng tài khoản (HTTP/SOCKS5).

### 2.5 `scheduler.js` (60 dòng) — Thuật toán lập lịch thuần túy (Pure Function)
- Không chứa I/O hay gọi mạng, chỉ tính toán matchmaking `[Task, Account]`:
  - **Ưu tiên 1**: Task đang xử lý dở dang (`sessionId != null`) bắt buộc phải về lại đúng account cũ.
  - **Ưu tiên 2**: Task có cờ `pin` thread nào thì ưu tiên đưa về account giữ thread đó.
  - **Ưu tiên 3**: Task `queued` phân bổ cho tài khoản có tỷ lệ quota còn lại cao nhất và có `lastUsedAt` lâu nhất.

### 2.6 `pool.js` (124 dòng) — Bộ điều phối Concurrency & Anti-ban
- **Vòng lặp Pump**: Chạy định kỳ mỗi 3–5 giây.
- **Anti-ban Jitter**: Giữa 2 lần submit prompt trên cùng một tài khoản, bắt buộc áp dụng **nghỉ ngẫu nhiên từ 15 đến 20 giây** để tránh bị Muse.ai phát hiện bot.
- **Kiểm tra đăng nhập (`checkLogin`)**: Retry 20 lần x 3 giây (tối đa 1 phút) chờ người dùng đăng nhập Chrome.

### 2.7 `product-ai.js` (457 dòng) — Sinh kịch bản Video UGC & Chuẩn hóa TTS
- **Ngân sách từ đọc (TTS Budget)**: Chuẩn hóa 4.6 từ/giây. Với một cảnh 10 giây, lời thoại phải nằm chính xác trong khoảng **40 đến 46 từ**.
- **Chuẩn hóa đọc tiếng Việt (`speak`)**:
  - Tiền tệ: `199k` / `199.000đ` → `một trăm chín mươi chín nghìn đồng`.
  - Số điện thoại: Chia thành từng cụm 3-4 số để đọc tự nhiên.
  - Loại bỏ toàn bộ emoji, icon, ký tự đặc biệt gây giật giọng đọc.
- **3 góc kịch bản mẫu**:
  1. *Góc 1*: Vấn đề thực tế → Giải pháp bất ngờ → Kêu gọi hành động.
  2. *Góc 2*: So sánh trước / sau khi sử dụng sản phẩm.
  3. *Góc 3*: Mở hộp (Unboxing) & Test thực tế tại kho.
- Đầu ra chuẩn: 3 cảnh x 10s (Visual Prompt tiếng Anh cho Muse + Lời thoại TTS tiếng Việt).

### 2.8 `ladi-crawler.js` (202 dòng) — Scraper Landing Page LadiPage
- Sử dụng HTTP fetch với User-Agent Chrome giả lập, xử lý redirect (301/302), timeout 15s.
- Dùng thư viện Cheerio bóc tách:
  - Ảnh: Quét `<img>`, `data-src`, CSS `background-image: url(...)`, JSON-LD Schema.
  - Tiêu đề & giá: Regex lọc giá bán, giá khuyến mãi, ưu đãi, cam kết.

### 2.9 `merge.js` (FFmpeg Video Stitcher)
- Sử dụng binary FFmpeg tĩnh đi kèm trong thư mục `resources/bin/ffmpeg.exe`.
- Ghép 3 cảnh 10s thành 1 video 30s liền mạch qua filter `concat`:
  ```bash
  ffmpeg -y -f concat -safe 0 -i concat.txt -c:v libx264 -c:a aac -pix_fmt yuv420p output.mp4
  ```
- Chuẩn hóa tỷ lệ khung hình: Scale và pad về chuẩn dọc 9:16 (1080x1920) hoặc ngang 16:9.
- Tự động xóa file danh sách tạm `concat.txt` trong khối `finally`.

### 2.10 `crm-server.js` (143 dòng) — Local REST API Server
- Lắng nghe tại `http://127.0.0.1:48900`.
- Xác thực qua header `X-API-Key` hoặc `Authorization: Bearer <key>`.
- Các API Endpoints:
  - `POST /api/v1/tasks`: Nhận prompt, ảnh, tạo task vào hàng đợi.
  - `GET /api/v1/tasks`: Lấy danh sách task (hỗ trợ lọc `?status=`).
  - `GET /api/v1/tasks/:id`: Chi tiết task và trạng thái render.
  - `POST /api/v1/tasks/:id/cancel` & `POST /api/v1/tasks/:id/retry`.
  - `GET /api/v1/tasks/:id/file?i=0`: Stream file MP4 nhị phân cho CRM/bên ngoài tải về.

### 2.11 `facebook-poster.js` (196 dòng) — Tự động đăng Reels
- Gọi Facebook Graph API v20.0.
- `fetchFacebookPages(token)`: Lấy danh sách Fanpage và Page Access Token.
- `publishReels`: Khởi tạo phiên upload tại `graph.facebook.com`, upload file video qua header `rupload.facebook.com`, publish với caption kèm hashtag.

### 2.12 `license-manager.js` — Quản lý Bản quyền cũ
- Sinh `machineId` dựa trên serial phần cứng và MAC address.
- Gọi server máy chủ kích hoạt của bên Vanh để check hạn key.
- Phân quyền Edition: `customer` (ẩn tab CRM API) và `pro` (mở toàn bộ tính năng).

### 2.13 `main.js` (753 dòng) — Electron Main Process
- Khởi tạo BrowserWindow (1240x840, `titleBarStyle: 'hidden'`).
- Quản lý vòng đời Chrome theo từng account (`pageFor(id)`).
- Routing toàn bộ IPC channels giữa Renderer và các module Engine.

### 2.14 Giao diện UI (`ui/index.html`, `ui/app.css`, `ui/script.js`)
- Giao diện 9 tabs: Text to Video, Image to Video, LadiPage Studio, Kho Video, Đăng Facebook, CRM API, Tài khoản, Cài đặt, Studio AI.
- Theme Neon Dark (`#0e1117`, `#1a1f2c`, `#00f2fe`).
- Không dùng framework nặng (React/Vue), chạy thuần Vanilla JS với Store pattern để giữ RAM < 150MB.

---

## 3. Các điểm mấu chốt để code một ứng dụng tương tự

1. **Automation Muse.ai**: Bắt buộc dùng Chrome thật bật CDP + duyệt React Fiber `memoizedProps` để gọi `sendMessage`. Không được bấm nút DOM chay vì Muse dùng React ảo hóa và dynamic hash.
2. **Anti-ban**: Phải có khoảng dừng ngẫu nhiên (jitter) 15-20s giữa các lần gửi prompt trên cùng tài khoản.
3. **Mỗi tài khoản 1 profile**: `--user-data-dir` tách biệt hoàn toàn + gán proxy riêng cho từng Chrome process.
4. **Tải file lớn**: Tải qua RPC `fs.raw` theo chunk 2MB base64.
5. **Nối video**: Bundle sẵn binary FFmpeg tĩnh, nối bằng `concat` codec h264/aac `pix_fmt yuv420p`.
