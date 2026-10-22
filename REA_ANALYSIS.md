# Phân tích app gốc (Vanh / Muse Studio Pro) bằng REA

> Công cụ: `rea-agents@6.7.0 analyze-javascript-application` trên `Vanh\resources\app.asar` (sha256 `fef664f3…d6c`).
> Kết quả: 654 node — 44 file JS/HTML, 65 IPC handler, 73 kênh IPC, 1 preload `electronAPI`, 1 BrowserWindow.
> Đối chiếu: giải nén `app.asar` bằng `@electron/asar` và `diff -r` với `resources\app` → **giống hệt**,
> mã nguồn không mã hoá/obfuscate, nên bản phân tích dưới đây đọc thẳng từ code, không đoán.

Bản `REA_ANALYSIS.md` cũ (Gemini viết) sai ở mấy điểm làm code cũ không chạy được:

| Bản cũ ghi | Thực tế trong app gốc |
|---|---|
| Chrome mở cổng `--remote-debugging-port`, nối WebSocket `/json` | `--remote-debugging-pipe`: CDP qua fd 3/4, mỗi tin JSON kết thúc `\0`, không mở cổng |
| 9 tab (Text to Video, Image to Video, Kho Video, Đăng Facebook…) | 8 tab: Studio, Tư liệu, Kịch bản, Thư viện, Tài khoản, LadiPage, API, Cài đặt |
| `sendMessage({text, attachments, targetRoute})`, duyệt Fiber từ `#root` | `sendMessage(text, attachments, { createNewThread \| targetRoute, waitForReadiness })`, duyệt Fiber bằng stack child+sibling từ phần tử đầu có `__reactContainer/__reactFiber` |
| Đọc phiên bằng `POST /api/rpc` | `window.__hatchEarlyGatewayRuntimeState.activeRuntime.getSnapshot().sendRequest('sessions.list' \| 'chat.history' \| 'chat.cancel' \| 'fs.raw')` |
| Ghép video re-encode libx264 | `-f concat -c copy` + `-progress pipe:1` để có % |
| Không nhắc | Studio store (dự án, nhân vật, mẫu prompt, người mẫu, ảnh luân phiên), proxy theo tài khoản, nhạc nền, hàng đợi Kịch bản lưu file, storyboard → video trong cùng chat, hạn mức tuần qua Next.js server action |

## Kiến trúc thật

```
UI (8 tab, vanilla JS)  ──IPC (preload electronAPI)──►  main.js
                                                         │
   API 127.0.0.1:48900 ─────────────────────────────────►│ submitTask()
   (v1 có key + API CRM cũ)                              ▼
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

## Các luồng quan trọng

- **Đăng nhập**: `GET /api/session` = 200 *và* tìm thấy client chat. Chưa đăng nhập → hiện Chrome (đưa cửa sổ từ toạ độ -32000 về màn hình), dò 5s/lần tối đa 15 phút, xong thì ẩn lại.
- **Task dở khi tắt app**: đã có `sessionId` → dò tiếp phiên cũ (không tốn lượt); chưa có → xếp hàng lại.
- **Lỗi**: lỗi mạng sau khi gửi → giữ phiên dò lại; lỗi do Muse (không ra file, quá giờ) → gửi lại bằng chat mới; hết `maxAttempts` → failed. "Muse không nhận lệnh" → đọc hạn mức, TK hết hạn mức thì trả task cho TK khác, không tính lượt.
- **Hạn mức**: dò id server action `fetchSubscriptionAction` trong các file JS trang đã tải, `POST /` với header `Next-Action`. Hết tuần mà còn token bổ sung (và bật "Dùng token") vẫn chạy.
- **Storyboard**: task ảnh (`kind: image`, `expect` = số cảnh) → link `https://muse.ai/thread/<sessionId>` → task video gửi tiếp vào đúng chat đó trên đúng tài khoản (`pin`), không vào được thì mở chat mới.
- **Proxy**: mỗi TK 1 proxy cố định (riêng hoặc tự lấy từ kho, ít TK dùng nhất); kiểm tra bằng CONNECT `muse.ai:443`; proxy có user/pass trả lời qua CDP `Fetch.authRequired`; kho có proxy mà tất cả chết → báo lỗi chứ không lộ IP thật.
- **LadiPage → kịch bản**: bóc giá/ưu đãi/tính năng/các bước/nỗi đau/bảng so sánh/mùa lễ/nhóm khách, sinh 9 góc kịch bản 3×10s (hoặc 3×8s, 2×8s), lời đọc vừa ~4,6 chữ/giây.

## Phần đã bỏ trong bản viết lại

- `license-manager.js` + hộp thoại khoá/kích hoạt key, badge dùng thử, Zalo hỗ trợ.
- `facebook-poster.js`, `fb.js` phần Facebook, IPC `fetch-fb-pages` / `verify-fb-token` / `publish-fb-reels`, `config-manager` lưu token FB.
- Cờ `edition=customer` (ẩn tab API) — bản mới luôn có tab API.
