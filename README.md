# MuseBatch Studio

App desktop (Electron, Windows) tạo ảnh/video hàng loạt trên Muse: mỗi tài khoản Muse chạy trong 1 Google Chrome thật
(profile + proxy riêng), điều khiển qua CDP, chia task song song nhiều tài khoản. Bản đầy đủ, không cần kích hoạt key.
Kiến trúc: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tính năng

- **Studio** — soạn nhiều prompt 1 lần (tách bằng dòng trống hoặc ký tự tuỳ chọn), tạo ảnh/video, tỉ lệ 9:16 · 16:9 · 1:1 · 4:3 · 3:4, ảnh tham chiếu (dùng chung / ghép cặp), mẫu prompt, người mẫu cố định, ảnh luân phiên, tự nhận nhân vật trong prompt. Hàng đợi task mọi nguồn (Studio, Kịch bản, API, CRM): tìm, lọc, chọn hàng loạt, chạy/dừng/xoá/chạy lại lỗi, ghép video, xem lớn, tạo lại, sửa prompt.
- **Tư liệu** — nhân vật (tối đa 3 ảnh), mẫu prompt, người mẫu cố định (3 ảnh), ảnh luân phiên (20 ảnh).
- **Kịch bản** — video nhiều cảnh: gộp 1 lệnh 10–60s hoặc từng cảnh rồi tự ghép; storyboard trước (tự làm hoặc chờ duyệt); 15 giọng đọc, nhân vật tự nói (lip-sync), người dẫn nam/nữ, nhân vật dẫn từ Tư liệu; nhiều ảnh sản phẩm × nhiều bản; nhạc nền ngẫu nhiên; hàng đợi lưu file, tắt app không mất.
- **LadiPage** — dán link, lấy ảnh/giá/ưu đãi, sinh 9 góc kịch bản (tình huống, trước/sau, demo, test kho, mở hộp, quà theo mùa, giá sốc, 2 kịch bản tay review không lời), sửa lời từng cảnh có đếm chữ, tuỳ chọn không đọc giá.
- **Tài khoản** — nhiều tài khoản Muse, số luồng mỗi tài khoản, TK chạy đồng thời, tổng luồng, chia việc luân phiên/lần lượt, hạn mức tuần + token bổ sung, proxy riêng hoặc kho proxy dự phòng có kiểm tra sống/chết.
- **Thư viện** — ảnh/video đã làm, lọc theo dự án, ghép video có thanh %, lưu ảnh vào Tư liệu, bỏ vào Thùng rác.
- **API** — `http://127.0.0.1:48900`: API v1 có key (tạo/xem/huỷ/chạy lại/xoá task, tải file) + API cũ cho Content CRM.
- **Dự án** — tách task theo dự án, tạm dừng dự án, xoá dự án kèm task.

## Chạy

Cần: Windows, Node.js 20+, Google Chrome.

```bash
npm install
npm start
```

ffmpeg dùng để ghép video và nhạc nền: chép `ffmpeg.exe`, `ffprobe.exe` và các file `.dll` của một bản ffmpeg build
shared (Windows x64) vào `resources\bin` (thư mục này không đưa lên git).

## Test

```bash
npm test
```

## Đóng gói bộ cài

```bash
npm run dist
```

Bộ cài NSIS nằm trong `dist\`. Nhớ chép ffmpeg vào `resources\bin` trước khi build.

## Build cho macOS (file .dmg)

Làm theo từng bước, không cần biết lập trình:

1. Mở **Terminal** (Cmd + Space, gõ `Terminal`, Enter).
2. Cài **Homebrew** nếu máy chưa có: dán lệnh ở https://brew.sh vào Terminal, Enter, làm theo hướng dẫn. Máy đã có thì bỏ qua.
3. Kéo thư mục dự án vào cửa sổ Terminal, Enter. Rồi chạy:

   ```bash
   bash scripts/build-mac.sh
   ```

4. Đợi xong (lần đầu khoảng 5–15 phút, tuỳ mạng). Script tự cài Node.js và ffmpeg nếu thiếu, build xong sẽ mở thư mục `dist` trong Finder.
5. Mở file `MuseBatch Studio-...dmg`, kéo app vào thư mục **Applications**.

**Lần mở đầu tiên:** app chưa có chữ ký của Apple nên macOS có thể chặn. Chuột phải vào app trong Applications → **Open** → **Open**.
Nếu vẫn bị chặn, mở Terminal và chạy:

```bash
xattr -cr "/Applications/MuseBatch Studio.app"
```

Máy mac cần cài **Google Chrome** (app dùng Chrome thật để chạy Muse). Ghép video cần ffmpeg, script đã cài sẵn qua Homebrew.

## Dữ liệu

Lưu trong `%APPDATA%\MuseBatch Studio`: `accounts.json`, `tasks.json`, `studio.json`, `queue.json`, `user_config.json`,
`profiles\<tài khoản>` (phiên Chrome), `task-images\`, `studio-images\`. Video mặc định lưu ở `Videos\MuseBatchStudio`.
