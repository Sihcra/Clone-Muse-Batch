'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePage, baseUrlOf } = require('../src/engine/ladi-crawler');
const { generateScriptsFromProduct, speak } = require('../src/engine/product-ai');
const { parseResult, parseQuota } = require('../src/engine/muse-page');
const Compose = require('../ui/compose');

const HTML = `<html><head><title>Hộp Lịch Mùa Vọng Giáng Sinh - 24 Mô Hình | Shop</title><script>var x="<b>no</b>"</script></head><body>
<img src="img/a.jpg"><img data-src="//cdn.ladicdn.com/b.png"><img src="/logo.png">
<div style="background-image: url('https://w.ladicdn.com/c.webp')"></div>
<p>Giá chỉ 399.000đ</p><p>Giá gốc: 599k</p><p>Miễn phí vận chuyển toàn quốc</p><p>Được kiểm tra hàng trước khi thanh toán</p>
<p>Bé tự tay lắp ghép 24 mô hình mini độc đáo treo cây thông rất vui mắt cho cả nhà.</p>
<p>Đèn LED ánh nến lung linh:</p><p>Mỗi hộp có đèn LED nhỏ tạo ánh sáng ấm áp, an toàn cho bé khi chơi buổi tối.</p>
<p>Thay vì cho con xem điện thoại cả ngày, cả nhà cùng nhau lắp ghép mỗi tối.</p>
<p>Nhận hàng trong 2-4 ngày</p>
</body></html>`;

test('parsePage: tiêu đề, ảnh (bỏ logo, ghép link tương đối), giá, chính sách', () => {
  const r = parsePage(HTML, 'https://shop.vn/lich');
  assert.match(r.title, /^Hộp Lịch Mùa Vọng/);
  assert.deepEqual(r.images, ['https://shop.vn/lich/img/a.jpg', 'https://cdn.ladicdn.com/b.png', 'https://w.ladicdn.com/c.webp']);
  assert.ok(r.prices.some(p => p.includes('399.000đ')));
  assert.ok(r.policies.some(p => /Miễn phí vận chuyển/.test(p)));
  assert.ok(!r.textSnippet.includes('no'));
  assert.equal(baseUrlOf('https://a.vn/x.html'), 'https://a.vn/x.html');
});

test('generateScriptsFromProduct: đủ góc kịch bản, mỗi kịch bản 3 cảnh, dữ kiện đúng', () => {
  const out = generateScriptsFromProduct(parsePage(HTML, 'https://shop.vn/lich'));
  assert.equal(out.facts.price, '399K');
  assert.equal(out.facts.original, '599K');
  assert.equal(out.facts.season, 'Giáng Sinh');
  assert.equal(out.facts.audience, 'các bố mẹ');
  assert.ok(out.facts.offers.includes('freeship toàn quốc'));
  const names = out.scripts.map(s => s.name);
  assert.ok(names.includes('Tình huống & giải pháp'));
  assert.ok(names.includes('Quà Giáng Sinh'));
  assert.ok(names.includes('Tay review: lắp & bày (không lời)'));
  for (const s of out.scripts) {
    assert.equal(s.scenes.length, 3);
    assert.deepEqual(s.scenes.map(x => x.time.split(' ')[0]), ['0–10s', '10–20s', '20–30s']);
    s.scenes.forEach(x => assert.ok(x.musePrompt.length > 20));
  }
  const talking = out.scripts.find(s => !s.silent);
  assert.match(talking.scenes[2].voiceover, /399 nghìn/);
});

test('tuỳ chọn không đọc giá và 2 cảnh × 8s', () => {
  const out = generateScriptsFromProduct(parsePage(HTML, 'https://shop.vn/lich'), { noPrice: true, scenes: 2, sceneSecs: 8 });
  const s = out.scripts.find(x => !x.silent);
  assert.equal(s.scenes.length, 2);
  assert.deepEqual(s.scenes.map(x => x.time.split(' ')[0]), ['0–8s', '8–16s']);
  assert.doesNotMatch(s.scenes[1].voiceover, /399 nghìn/);
  assert.match(s.scenes[1].voiceover, /link/);
});

test('speak: chuẩn hoá cho giọng đọc', () => {
  assert.equal(speak('giảm 30% từ 5-7 ngày, 24/12 & quà'), 'Giảm 30 phần trăm từ 5 đến 7 ngày, 24 tháng 12 và quà');
});

test('parseResult/parseQuota của Muse', () => {
  const r = parseResult([{ text: 'xong', images: [{ path: 'i', mime: 'image/png', byte_len: 3 }], videos: [{ path: 'v', mime: 'video/mp4', byte_len: 9 }, { path: 'm', missing: true }] }]);
  assert.deepEqual(r.files.map(f => f.path), ['v', 'i']);
  assert.equal(r.text, 'xong');
  const q = parseQuota({ usage: { percentUsed: 42, resetsAt: 100, quotaStatus: 'SUFFICIENT' }, tier: { name: 'Pro', isPaid: true }, topupBalance: 5, topupTotal: 10 });
  assert.deepEqual([q.pct, q.resetsAt, q.tier, q.topupLeft], [42, 100000, 'Pro', 0.5]);
  assert.equal(parseQuota({}), null);
});

test('Compose: người mẫu → nhân vật → luân phiên → ảnh tham chiếu, tối đa 8', () => {
  const characters = [{ name: 'Mai', images: ['m1'] }, { name: 'Lan', images: ['l1', 'l2'] }];
  assert.deepEqual(Compose.findCharacters('ngày mai đi chơi', characters), []);
  assert.deepEqual(Compose.findCharacters('Mai và @lan', characters).map(c => c.name), ['Mai', 'Lan']);
  assert.equal(Compose.untag('@Mai cười', characters), 'Mai cười');
  const r = Compose.imagesFor({
    prompt: 'Mai cầm hộp', characters, model: { on: true, images: ['mo'] },
    rotate: { on: true, images: ['r1', 'r2'], idx: 1 }, refs: ['a', 'b', 'c', 'd', 'e']
  });
  assert.deepEqual(r.images, ['mo', 'm1', 'r2', 'a', 'b', 'c', 'd', 'e']);
  assert.equal(r.cut, 0);
  assert.equal(r.rotateIdx, 2);
  assert.deepEqual(Compose.imagesFor({ prompt: 'x', refs: ['a', 'b'], mode: 'pair', index: 1 }).images, ['b']);
});
