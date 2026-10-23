# Kiến trúc MuseBatch Studio

```
UI (8 tab, vanilla JS)  ──IPC (preload electronAPI)──►  src/main.js
                                                         │
   API 127.0.0.1:48900 ─────────────────────────────────►│ submitTask()
   (v1 có key + API Content CRM)                         ▼
                                         TaskStore (tasks.json, task-images/)
                                                         │
                         StudioStore (dự án tạm dừng) ──►│
                                                         ▼
                         Scheduler.plan()  — hàm thuần: task ↔ tài khoản
                                                         ▼
                         Pool.runOne()  — giữ chỗ, checkLogin, nghỉ 15–20s/TK, runTask, failurePatch
                                                         ▼
                         MuseRunner.runTask() — gửi → sessionId → dò 4s/lần → tải fs.raw 2MB/đoạn
                                                         ▼
                         MusePage (window.__mss) ── CDP pipe ──► Chrome thật (profile/TK, proxy/TK)
```

## Module

| File | Việc |
|---|---|
| `src/engine/chrome.js` | Mở Google Chrome với `--remote-debugging-pipe` (CDP qua fd 3/4, JSON kết thúc `\0`), profile riêng, đưa cửa sổ ra/vào màn hình, trả lời đăng nhập proxy qua `Fetch.authRequired`, shim báo trang luôn "visible" |
| `src/engine/muse-page.js` | Cầu nối nạp vào trang Muse: tìm client chat trong cây React, `sendMessage(text, attachments, { createNewThread \| targetRoute, waitForReadiness })`, RPC `sessions.list` / `chat.history` / `chat.cancel` / `fs.raw`, đọc hạn mức qua server action `fetchSubscriptionAction` |
| `src/engine/muse-runner.js` | Chạy 1 task: gửi lệnh, dò phiên, quá giờ thì huỷ, tải file kết quả; quy tắc thử lại |
| `src/engine/scheduler.js` | Chọn cặp task ↔ tài khoản: task dở về đúng TK cũ, task làm tiếp chat về đúng TK giữ chat, còn lại chia theo số việc → hạn mức → lâu chưa dùng |
| `src/engine/pool.js` | Chạy song song, giữ chỗ trước khi dò đăng nhập, nghỉ 15–20s giữa 2 lần gửi cùng TK, hết hạn mức thì trả task cho TK khác |
| `src/engine/proxy.js` | Đọc/kiểm tra proxy (CONNECT `muse.ai:443`, socks5), chọn proxy cố định cho từng TK |
| `src/engine/task-store.js` · `studio-store.js` · `accounts.js` · `config.js` | Lưu JSON (ghi file tạm rồi đổi tên) |
| `src/engine/merge.js` | ffmpeg concat `-c copy` có %, nhạc nền lót dưới giọng đọc |
| `src/engine/crm-server.js` | API nội bộ |
| `src/engine/ladi-crawler.js` · `product-ai.js` | Lấy dữ liệu landing page, sinh kịch bản nhiều góc |

## Các luồng quan trọng

- **Đăng nhập**: `GET /api/session` = 200 *và* tìm thấy client chat. Chưa đăng nhập → hiện Chrome, dò 5s/lần tối đa 15 phút, xong thì ẩn lại.
- **Task dở khi tắt app**: đã có `sessionId` → dò tiếp phiên cũ (không tốn lượt); chưa có → xếp hàng lại.
- **Lỗi**: lỗi mạng sau khi gửi → giữ phiên dò lại; lỗi do Muse (không ra file, quá giờ) → gửi lại bằng chat mới; hết số lần thử → failed. "Muse không nhận lệnh" → đọc hạn mức, TK hết hạn mức thì trả task cho TK khác, không tính lượt.
- **Hạn mức**: hết tuần mà còn token bổ sung (và bật "Dùng token") vẫn chạy; qua mốc đặt lại thì tự chạy tiếp.
- **Storyboard**: task ảnh (`kind: image`, `expect` = số cảnh) → link `https://muse.ai/thread/<sessionId>` → task video gửi tiếp vào đúng chat đó trên đúng tài khoản (`pin`), không vào được thì mở chat mới.
- **Proxy**: mỗi TK 1 proxy cố định (riêng hoặc tự lấy từ kho, ít TK dùng nhất); kho có proxy mà tất cả chết → báo lỗi chứ không lộ IP thật.
- **Landing page → kịch bản**: bóc giá/ưu đãi/tính năng/các bước/nỗi đau/bảng so sánh/mùa lễ/nhóm khách, sinh 9 góc kịch bản 3×10s (hoặc 3×8s, 2×8s), lời đọc vừa ~4,6 chữ/giây.
