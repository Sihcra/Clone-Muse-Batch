'use strict';
/**
 * SINH KỊCH BẢN TỪ LADIPAGE — bóc tên / giá / ưu đãi / tính năng / cách dùng / nỗi đau khách từ chữ trên trang,
 * rồi sinh nhiều góc kịch bản (mặc định 3 cảnh × 10s) cho Muse: mỗi cảnh có lời đọc (TTS) + mô tả hình 3 nhịp.
 * Góc: tình huống → giải pháp, trước/sau, "Nhìn này" demo, test tại kho, hàng mới về, quà theo mùa, giá sốc,
 * và 2 kịch bản "tay review" không lời. Tuỳ chọn không đọc giá (giá để ở link).
 */

// Giọng TTS của Muse đọc ~4,6 chữ/giây → 1 cảnh 10s cần ~40–46 chữ.
const VOICE_MIN = 40;
const VOICE_MAX = 46;
const budgetFor = secs => (secs === 10 ? { min: VOICE_MIN, max: VOICE_MAX } : { min: Math.round(secs * 4), max: Math.round(secs * 4.6) });

const HANDS_STYLE = 'quay cận bằng điện thoại kiểu người thật review, chỉ thấy đôi bàn tay thao tác (không thấy mặt, không người dẫn), bàn tay tự nhiên đủ năm ngón, ánh sáng ấm thật, nền mờ ảo (bokeh); sản phẩm, bao bì và chữ in giữ đúng như ảnh đính kèm, không đổi màu hay kiểu dáng';
const handsAudio = tune => `Không lời thoại, không người nói, không lồng tiếng. Chỉ ${tune}, âm lượng vừa phải, xuyên suốt video; giữ tiếng động thật nhỏ khi tay thao tác (mở hộp, lắp ghép).`;
const STYLE = 'quay bằng điện thoại kiểu người thật review, ánh sáng thật, người Việt bình thường (không phải người mẫu), cùng một người dẫn xuyên suốt video; bàn tay tự nhiên đủ năm ngón; sản phẩm, bao bì và chữ in giữ đúng như ảnh đính kèm, không đổi màu hay kiểu dáng';

// ---------- tiện ích chữ ----------
const countWords = s => String(s).trim().split(/\s+/).filter(Boolean).length;
const startsLower = s => /^\p{Ll}/u.test(s || '');
const lowerFirst = s => (s && s[1] && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clip = (s, n) => s.split(/\s+/).slice(0, n).join(' ');
const decode = s => String(s).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
// "Treo Cây Thông & Sưu Tầm" → "treo cây thông & sưu tầm", giữ từ viết hoa toàn bộ (ABS, LED)
const lowerAll = s => s.split(/\s+/).map(w => (w.length > 1 && w === w.toUpperCase() && /[A-ZÀ-Ỹ]/.test(w) ? w : w.toLowerCase())).join(' ');
const joinList = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} và ${items[items.length - 1]}`);
const isShouting = s => { const letters = s.replace(/[^a-zà-ỹA-ZÀ-Ỹ]/g, ''); return letters.length > 3 && letters === letters.toUpperCase(); };
const cleanText = s => decode(s).replace(/[\u{1F300}-\u{1FAFF}☀-➿★⭐✨™®]/gu, '').replace(/\s*\([^)]*\)/g, '').replace(/[:：]\s*$/, '').trim();
const sentencesOf = s => cleanText(s).split(/(?<=[.!?])\s+/).map(x => x.replace(/[.!?]+$/, '').trim());

// Chữ cho giọng đọc: bỏ ký hiệu TTS đọc vấp, khoảng số thành "đến", ngày "1/12" → "1 tháng 12", "%" → "phần trăm",
// không lặp "nhé" nhiều lần, viết hoa đầu câu.
function speak(s) {
  let t = decode(s)
    .replace(/\s*[&+]\s*/g, ' và ')
    .replace(/\s*[→➔]\s*/g, ', ')
    .replace(/\s+\/\s+/g, ' hay ')
    .replace(/(\d)\s*[-–]\s*(\d)/g, '$1 đến $2')
    .replace(/\b(\d{1,2})\/(\d{1,2})\b/g, '$1 tháng $2')
    .replace(/(\d)\s*%/g, '$1 phần trăm')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?])[,.]+/g, '$1')
    .trim();
  const parts = t.split(/ nhé(?=[\s.!?,]|$)/);
  if (parts.length > 2) t = parts.slice(0, -1).join('') + ' nhé' + parts[parts.length - 1];
  return t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
}
const spokenWords = s => countWords(speak(s));

// Ghép câu bắt buộc rồi thêm câu phụ tới khi đủ số chữ của cảnh. Câu phụ dạng mảng = phương án dài → ngắn.
function fitter(budget) {
  return (required, optional = []) => {
    let text = required.filter(Boolean).join(' ');
    for (const opt of optional) {
      if (spokenWords(text) >= budget.min) break;
      const pick = [].concat(opt).filter(Boolean).find(a => !text.includes(a) && spokenWords(`${text} ${a}`) <= budget.max);
      if (pick) text = text ? `${text} ${pick}` : pick;
    }
    return text;
  };
}

// ---------- bóc dữ kiện ----------
// Dòng LadiPage hay bị ngắt giữa câu → nối lại
function mergeBroken(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const prev = out[out.length - 1];
    const open = prev && !/[.!?:]$/.test(prev) && !isShouting(prev);
    const continues = startsLower(l) || (/^\d/.test(l) && !/\d\s*(k|đ|₫)/i.test(l) && startsLower(lines[i + 1]) && countWords(prev || '') >= 5);
    if (open && continues) out[out.length - 1] = `${prev} ${l}`;
    else out.push(l);
  });
  return out;
}

function productNames(title) {
  const full = decode(title || 'sản phẩm này').split(/\s+\|\s+/)[0].trim().slice(0, 120);
  const [head, ...rest] = full.split(/\s+[—–\-:(]\s*/);
  const short = clip(head.trim(), 10);
  const kind = rest.length ? clip(lowerAll(rest.join(' ').split(/\s+\d/)[0]), 6) : short;
  return { full, short, kind };
}

const PRICE_RE = /(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(k|nghìn|ngàn|₫|đ|vnđ|đồng)(?![a-zà-ỹ])/gi;
const money = n => ({
  n,
  label: n % 1000 === 0 ? `${(n / 1000).toLocaleString('vi-VN')}K` : `${n.toLocaleString('vi-VN')}đ`,
  voice: n >= 1e6 ? `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} triệu` : `${Math.round(n / 1000)} nghìn`
});
const toVnd = (num, unit) => Number(num.replace(/[.,]/g, '')) * (/^(k|nghìn|ngàn)$/i.test(unit) ? 1000 : 1);

// Giá đầu tiên hợp lệ, bỏ số tiền ship / tiết kiệm / giảm / giá gốc / tặng
function parsePrice(lines) {
  for (const line of lines) {
    const re = new RegExp(PRICE_RE.source, 'gi');
    let m;
    while ((m = re.exec(line))) {
      const before = line.slice(Math.max(0, m.index - 16), m.index);
      if (/(giảm|tiết kiệm|phí|ship|tặng|voucher|giá gốc|\+)\s*$/i.test(before)) continue;
      const n = toVnd(m[1], m[2]);
      if (n >= 10000) return money(n);
    }
  }
  return null;
}

function parseDeals(text, price) {
  const orig = /giá\s*gốc\s*:?\s*(\d[\d.,]*)\s*(k|nghìn|ngàn|₫|đ)/i.exec(text);
  const original = orig && toVnd(orig[1], orig[2]) > (price ? price.n : 0) ? money(toVnd(orig[1], orig[2])) : null;
  const disc = /(?:tiết\s*kiệm|giảm(?:\s*giá)?|sale|off)\s*(?:đến\s*|tới\s*)?(\d{1,2})\s*%/i.exec(text);
  let unit = null;
  const re = /chỉ\s*(?:còn\s*)?(\d[\d.,]*)\s*(k|nghìn|ngàn|₫|đ)\s*\/\s*(hộp|bộ|cái|chai|lọ|set|sản phẩm|gói|túi)/gi;
  let m;
  while ((m = re.exec(text))) {
    const n = toVnd(m[1], m[2]);
    if (!unit || n < unit.n) unit = { ...money(n), unit: m[3].toLowerCase() };
  }
  const ship = /(?:nhận|giao)\s*hàng\s*(?:trong\s*|sau\s*)?(\d+\s*[-–]\s*\d+|\d+)\s*ngày/i.exec(text);
  return {
    original,
    discount: disc ? Number(disc[1]) : 0,
    unit: unit && price && unit.n < price.n ? unit : null,
    delivery: ship ? `${ship[1]} ngày` : ''
  };
}

function parseOffers(text) {
  const offers = [];
  if (/freeship|miễn\s*phí\s*(vận\s*chuyển|giao|ship)/i.test(text)) {
    const combo = /(\d+)\s*(bộ|hộp|sản phẩm|sp|cái|chai|lọ|set)(?=\s)([^·\n]{0,20}?)freeship/i.exec(text);
    offers.push(combo ? `mua từ ${combo[1]} ${combo[2].toLowerCase()} được freeship` : 'freeship toàn quốc');
  }
  if (/đồng\s*kiểm|kiểm\s*(tra\s*)?hàng|mở\s*hộp[^.\n]{0,40}(thanh toán|trả tiền)/i.test(text)) offers.push('được kiểm tra hàng rồi mới trả tiền');
  else if (/thanh\s*toán\s*khi\s*nhận|\bcod\b/i.test(text)) offers.push('thanh toán khi nhận hàng');
  const warranty = /bảo\s*hành\s*(\d+\s*(tháng|năm))/i.exec(text);
  if (warranty) offers.push(`bảo hành ${warranty[1]}`);
  if (/đổi\s*trả|hoàn\s*tiền/i.test(text)) offers.push('đổi trả dễ dàng');
  return offers.slice(0, 2);
}

const NOT_USP = /freeship|ship|đồng\s*kiểm|thanh\s*toán|đặt\s*(hàng|mua)|mua\s*ngay|inbox|hotline|liên\s*hệ|combo|ưu\s*đãi|giảm|tiết\s*kiệm|bảo\s*hiểm|đánh\s*giá|đã\s*bán|^gồm\b|\d+\s*(k|đ|₫)\b/i;

// Ý chính 1 đoạn mô tả: câu đầu ≥8 chữ, cắt ở dấu phẩy để ≤18 chữ
function shortDetail(line) {
  const s = (sentencesOf(line).find(x => countWords(x) >= 8) || '').replace(/:\s+/, ' như ');
  let out = '';
  for (const part of s.split(/,\s*/)) {
    const next = out ? `${out}, ${part}` : part;
    if (countWords(next) > 18) break;
    out = next;
  }
  return out && countWords(out) >= 4 && !NOT_USP.test(out) ? lowerFirst(out) : '';
}

// Tính năng: dòng tiêu đề kết thúc bằng ":" + ý chính dòng dưới; thiếu thì lấy câu ngắn trong đoạn mô tả
function parseFeatures(lines, fullName) {
  const ok = s => s && !NOT_USP.test(s) && !isShouting(s) && s !== fullName && countWords(s) >= 3 && countWords(s) <= 14;
  const seen = new Set();
  const features = [];
  lines.forEach((l, i) => {
    if (!/^[^:]{8,70}:\s*$/.test(l)) return;
    const title = cleanText(l);
    if (!ok(title) || seen.has(title)) return;
    seen.add(title);
    features.push({ title: lowerAll(title), detail: shortDetail(lines[i + 1] || '') });
  });
  lines.filter(l => l.length > 40).flatMap(sentencesOf).flatMap(x => x.split(/\s+—\s+/))
    .filter(x => ok(x) && countWords(x) >= 6 && !seen.has(x))
    .forEach(x => { seen.add(x); features.push({ title: lowerFirst(x), detail: '' }); });
  return features.slice(0, 3);
}

function parseIntro(lines, fullName) {
  const titleCase = l => l.split(/\s+/).filter(w => /^[A-ZÀ-Ỹ]/.test(w)).length > countWords(l) / 2;
  for (const l of lines) {
    if (countWords(l) < 14 || NOT_USP.test(l) || isShouting(l) || titleCase(l) || l.startsWith(fullName)) continue;
    let s = sentencesOf(l)[0];
    const dash = s.split(/\s+[—–]\s+/);
    if (dash.length > 1 && countWords(dash[1]) >= 8) s = dash[1];
    if (countWords(s) >= 8 && countWords(s) <= 28) return { full: s + '.', short: s.split(/,\s*/)[0] + '.' };
  }
  return null;
}

function parseContents(lines) {
  const l = lines.find(x => /^gồm\s*:/i.test(x));
  if (!l) return '';
  const items = decode(l).replace(/^gồm\s*:\s*/i, '').replace(/\.$/, '').split(/\s*[+;]\s*|,\s*(?=\d)/)
    .map(s => s.replace(/\s*\([^)]*\)/g, '').trim())
    .filter(s => s && !NOT_USP.test(s) && !/miễn\s*phí/i.test(s));
  return items.length ? joinList(items.slice(0, 4)) : '';
}

function parseSteps(lines) {
  const at = lines.findIndex(l => /\b\d\s*bước\b/i.test(l) && countWords(l) <= 12);
  if (at < 0) return [];
  const steps = [];
  for (let i = at + 1; i < lines.length - 1 && steps.length < 4; i++) {
    const [t, d] = [lines[i], lines[i + 1]];
    if (isShouting(t) || /[\u{1F300}-\u{1FAFF}]/u.test(t)) break;
    if (countWords(t) <= 7 && countWords(d) >= 10) {
      steps.push({ title: lowerAll(cleanText(t)).split(/\s*&\s*/)[0], detail: lowerFirst(sentencesOf(d)[0]) });
      i++;
    }
  }
  return steps;
}

function parsePain(lines) {
  for (const s of lines.flatMap(sentencesOf)) {
    let m = /thay\s*vì\s+([^,]{4,60}),\s*(.{10,})/i.exec(s);
    if (m) return { kind: 'habit', pain: lowerFirst(m[1].trim()), gain: lowerFirst(m[2].trim()) };
    m = /(?:không\s*còn|hết\s*lo|không\s*lo|tạm\s*biệt|chấm\s*dứt)\s+([^,.]{4,50})/i.exec(s);
    if (m && countWords(s) <= 30) return { kind: 'worry', pain: lowerFirst(m[1].trim()), gain: '' };
  }
  return null;
}

// Bảng so sánh "loại thông thường" vs sản phẩm
function parseOldWay(lines) {
  const at = lines.findIndex(l => /thông\s*thường|loại\s*thường|truyền\s*thống|hàng\s*chợ|trôi\s*nổi/i.test(l) && countWords(l) <= 10 && !/:\s*$/.test(l));
  if (at < 0) return null;
  const isLabel = l => /:\s*$/.test(l);
  const take = from => {
    const out = [];
    let i = from;
    for (; i < lines.length && out.length < 3; i++) {
      if (isLabel(lines[i])) continue;
      if (countWords(lines[i]) < 4 || isShouting(lines[i])) break;
      out.push(lowerFirst(cleanText(lines[i])));
    }
    return { out, end: i };
  };
  const cons = take(at + 1);
  const next = lines.findIndex((l, i) => i > cons.end && isLabel(l));
  const pros = next > 0 ? take(next).out : [];
  return cons.out.length ? { name: lowerFirst(cleanText(lines[at])), cons: cons.out, pros } : null;
}

function parseProof(text) {
  const sold = /đã\s*bán\s*([\d.,]+)/i.exec(text);
  const rate = /\b([3-5][.,]\d)\s*\/\s*5\b/.exec(text);
  const parts = [sold && `Đã có hơn ${sold[1]} khách đặt mua`, rate && `đánh giá ${rate[1].replace('.', ',')} trên 5 sao`].filter(Boolean);
  return parts.length ? parts.join(', ') + '.' : '';
}

const AUDIENCES = [
  { re: /(?<!\p{L})(bé|trẻ\s*(em|nhỏ)|con\s*(yêu|nhỏ)|mẹ\s*bỉm|bố\s*mẹ)(?!\p{L})/iu, call: 'các bố mẹ', setting: 'phòng khách gia đình người Việt, có đồ chơi của bé' },
  { re: /(?<!\p{L})(làn\s*da|da\s*mặt|mỹ\s*phẩm|son\s*môi|mái\s*tóc|làm\s*đẹp|serum|kem\s*dưỡng|váy|đầm)(?!\p{L})/iu, call: 'chị em', setting: 'phòng ngủ gọn gàng có bàn trang điểm' },
  { re: /(?<!\p{L})(ô\s*tô|xe\s*hơi|xe\s*máy|máy\s*khoan|đồ\s*nghề|camera|ổ\s*cắm|đèn\s*pin|câu\s*cá)(?!\p{L})/iu, call: 'anh em', setting: 'gara nhà ở Việt Nam, kệ đồ nghề phía sau' }
];
const DEFAULT_AUDIENCE = { call: 'mọi người', setting: 'phòng khách sáng sủa của một gia đình Việt' };

const SEASONS = [
  { re: /giáng\s*sinh|noel|christmas|mùa\s*vọng/i, name: 'Giáng Sinh', short: 'Noel',
    hook: 'Giáng Sinh này tặng gì cho cả nhà vừa ý nghĩa vừa vui?',
    setting: 'Phòng khách nhà người Việt trang trí Giáng Sinh, cây thông có đèn nháy vàng ấm',
    spot: 'dưới gốc cây thông Noel có đèn nháy', tune: 'nhạc Giáng Sinh không lời nhẹ nhàng (piano, hộp nhạc, chuông leng keng)' },
  { re: /\btết\b|năm\s*mới/i, name: 'Tết', short: 'Tết',
    hook: 'Tết này biếu gì cho gia đình vừa sang vừa ý nghĩa?',
    setting: 'Phòng khách ngày Tết có cành đào, mâm ngũ quả và câu đối đỏ',
    spot: 'cạnh cành đào và mâm ngũ quả ngày Tết', tune: 'nhạc Tết không lời nhẹ nhàng (đàn tranh, sáo trúc)' },
  { re: /trung\s*thu/i, name: 'Trung Thu', short: 'Trung Thu',
    hook: 'Trung Thu này tặng gì cho cả nhà vừa ý nghĩa vừa vui?',
    setting: 'Sân nhà đêm Trung Thu treo đèn lồng đỏ',
    spot: 'giữa những chiếc đèn lồng Trung Thu', tune: 'nhạc Trung Thu không lời nhẹ nhàng' }
];

// Hình mỗi cảnh viết như shot list 3 nhịp để Muse dựng có chuyển động
const shots = (a, b, c) => `Đầu cảnh: ${a}. Giữa cảnh: ${b}. Cuối cảnh: ${c}.`;

/**
 * scraped: { title, images, prices, policies, textSnippet } từ ladi-crawler.
 * opts: { noPrice, sceneSecs (10|8), scenes (3|2) }
 */
function generateScriptsFromProduct(scraped, opts = {}) {
  const { title, images = [], prices = [], policies = [], textSnippet = '' } = scraped;
  const lines = mergeBroken(String(textSnippet).split('\n').map(s => decode(s).trim()).filter(Boolean));
  const { full: productName, short: name, kind } = productNames(title);
  const allText = decode([...prices, ...policies, ...lines].join('\n'));
  const price = parsePrice(prices.map(decode));
  const deals = parseDeals(allText, price);
  const offers = parseOffers(allText);
  const features = parseFeatures(lines, productName);
  const highlights = features.map(f => f.title);
  const intro = parseIntro(lines, productName);
  const contents = parseContents(lines);
  const steps = parseSteps(lines);
  const pain = parsePain(lines);
  const old = parseOldWay(lines);
  const proof = parseProof(allText);
  const season = SEASONS.find(s => s.re.test([title, ...lines.slice(0, 20)].join(' ')));
  const aud = AUDIENCES.find(a => a.re.test(allText)) || DEFAULT_AUDIENCE;
  const G = aud.call;
  const place = season ? season.setting : cap(aud.setting);
  const noPrice = Boolean(opts.noPrice);
  const secs = opts.sceneSecs || 10;
  const twoScenes = opts.scenes === 2;
  const fit = fitter(budgetFor(secs));

  // Mỗi tính năng có 2 cách nói: kèm ý chính, hoặc chỉ tên (khi không đủ chỗ)
  const featSay = (f, lead) => f && [f.detail && `${lead} ${f.title}, ${f.detail}.`, `${lead} ${f.title}.`];
  const [f1, f2, f3] = features;
  const featurePads = [featSay(f2, 'Thêm nữa là'), featSay(f3, 'Và'), proof,
    'Cầm trên tay mới thấy hoàn thiện rất chỉn chu.', 'Hàng y như hình, nhận về là ưng ngay.', 'Dùng thực tế rất tiện, ai dùng rồi cũng khen.'];
  const introPads = [intro && [intro.full, intro.short]];
  const hook = (required, optional) => fit(required, [...optional, `Mình nói nhanh điểm hay cho ${G}.`, 'Hàng thật, quay thật, không chỉnh sửa.', 'Xem hết video là biết vì sao bán chạy.']);
  const stepSay = steps.length ? `Dùng cực dễ: ${joinList(steps.slice(0, 3).map(s => s.title))}.` : '';
  const stepProof = (steps.find(s => /phút|giây|mảnh|lần/.test(s.detail)) || steps.find(s => /\d/.test(s.detail)) || steps[0] || {}).detail;

  const priceSay = noPrice
    ? `${deals.discount ? `Đợt này đang giảm tới ${deals.discount}%, ` : ''}giá ưu đãi mình để ở link ngay dưới video.`
    : price
      ? `${deals.original ? `Giá gốc ${deals.original.voice}, hôm nay chỉ còn ${price.voice}` : `Giá chỉ ${price.voice}`}${deals.unit ? `, mua combo chỉ còn ${deals.unit.voice} một ${deals.unit.unit}` : ''}.`
      : 'Đợt này đang có ưu đãi rất tốt.';
  const offerSay = offers.length ? cap(offers.join(', ')) + '.' : '';
  const shipSay = deals.delivery && (season ? `Giao ${deals.delivery}, đặt từ giờ là kịp trước ${season.short}.` : `Giao toàn quốc ${deals.delivery} là nhận.`);
  const closePads = [offerSay, shipSay, proof, 'Số lượng ưu đãi có hạn nên đặt sớm kẻo lỡ.', 'Để lại bình luận, shop tư vấn ngay.', 'Hàng có hạn đó!'];
  const close = (lead, cta) => fit([lead, priceSay, cta], closePads);
  const closeShots = shots('Người dẫn cầm sản phẩm đưa về phía máy như trao tận tay, cười thân thiện',
    'máy lùi ra cho thấy trọn sản phẩm và hộp đặt cạnh nhau', 'người dẫn chỉ tay xuống phía dưới màn hình, gật đầu chốt');

  // Hình cảnh điểm mạnh nhắc đúng tính năng mà lời có đọc
  const showUsp = voice => { const used = highlights.filter(h => voice.includes(h)); return used.length ? `, lần lượt làm rõ: ${used.join('; ')}` : ''; };
  const scene = (index, time, voiceover, musePrompt) => ({ index, time, voiceover: speak(voiceover), musePrompt, image: images[index - 1] || images[0] || '' });
  const uspScene = (time, voice, visual) => scene(2, time, voice, visual(showUsp(voice)));
  const featureVoice = (lead, required = []) => fit(required, [featSay(f1, lead) || 'Thiết kế đẹp, từng chi tiết hoàn thiện rất kỹ.', ...featurePads]);

  const scripts = [];
  const add = (scriptName, scenes, extra) => scripts.push({ id: `script_${scripts.length + 1}`, name: scriptName, scenes, ...extra });

  // 1. Tình huống → giải pháp
  const painHook = pain
    ? (pain.kind === 'habit' ? `${cap(G)} có thấy cảnh này quen không? Cứ rảnh là lại ${pain.pain}.` : `${cap(G)} có ai đang khổ vì ${pain.pain} không?`)
    : old ? `Trước giờ dùng ${old.name} thì ${old.cons[0]}.` : '';
  if (painHook) {
    add('Tình huống & giải pháp', [
      scene(1, '0–10s · Nỗi đau',
        hook([painHook], [old && pain && `Còn mua ${old.name} thì ${old.cons[0]}.`, 'Mình cũng từng như vậy.', 'Cho tới khi mình tìm ra cái này.', 'Xem tiếp nhé.']),
        shots(`${place}. Tình huống đời thường đúng nỗi khó chịu: ${pain ? pain.pain : old.cons[0]}`,
          'người dẫn quay sang máy thở dài, nhún vai nói như kể chuyện', 'người dẫn chợt nhớ ra, với tay lấy sản phẩm')),
      uspScene('10–20s · Giải pháp',
        featureVoice('Lại còn', [pain && pain.gain ? `Từ khi có ${name}, ${pain.gain}.` : `Từ khi có ${name} là khác hẳn.`]),
        u => shots('Người dẫn mở sản phẩm ra dùng ngay tại chỗ', `cận cảnh sản phẩm đang được dùng, vấn đề được giải quyết${u}`, 'mọi người xung quanh vui vẻ, người dẫn cười nói vào máy')),
      scene(3, '20–30s · Chốt', close('Đỡ hẳn một nỗi lo.', 'Cần thì cứ chốt ở link bên dưới nhé!'), closeShots)
    ]);
  }

  // 2. Trước & sau
  const before = old && pain ? old : null;
  if (before) {
    add('Trước & sau', [
      scene(1, '0–10s · Trước',
        hook([`Trước đây nhà mình toàn dùng ${before.name}, ${before.cons[0]}.`],
          [before.cons[1] && `${cap(before.cons[1])}.`, before.cons[2] && `${cap(before.cons[2])}.`, `${cap(G)} có ai cũng vậy không?`, 'Cho tới khi mình đổi sang cái này.']),
        shots(`Cảnh TRƯỚC: ${before.name} trên bàn, mọi người hờ hững, màu hình hơi xám buồn`, 'người dẫn lắc đầu nói vào máy', 'người dẫn vẩy tay chuyển cảnh')),
      uspScene('10–20s · Sau',
        featureVoice('Đặc biệt là', [`Còn bây giờ với ${name} thì khác hẳn${before.pros.length ? `: ${joinList(before.pros.slice(0, 2))}` : ''}.`]),
        u => shots('Cảnh SAU: cùng góc máy, cùng căn phòng nhưng có sản phẩm, ánh sáng tươi ấm', `cận cảnh sản phẩm${u}`, 'người dẫn hài lòng gật đầu nói vào máy')),
      scene(3, '20–30s · Chốt', close('Khác biệt nhìn là thấy.', 'Cần cứ chốt ở link bên dưới nhé!'), closeShots)
    ]);
  }

  // 3. "Nhìn này!" demo
  add('Nhìn này! (demo)', [
    scene(1, '0–10s · Demo hook',
      hook([`Nhìn này! ${intro ? intro.full : `Đây là ${name}.`}`], [featSay(f1, 'Điểm hay là'), `Đây là ${name}.`, 'Nhìn thôi đã thấy mê.']),
      shots('Cận cảnh rất gần, hai tay thao tác sản phẩm mượt mà, khung hình đã mắt', 'quay chậm chi tiết đẹp nhất của sản phẩm', 'máy lùi ra thấy toàn bộ sản phẩm và người dẫn đang cười')),
    uspScene('10–20s · Cách dùng',
      fit([stepSay], [stepProof && `${stepProof}.`, featSay(f2, 'Thêm nữa là'), featSay(f3, 'Và'), ...featurePads]),
      u => shots(steps.length ? `Lần lượt từng bước: ${steps.slice(0, 3).map(s => s.title).join(' → ')}` : 'Hai tay dùng thử sản phẩm từng bước', `cận cảnh kết quả${u}`, 'người dẫn giơ thành phẩm về phía máy')),
    scene(3, '20–30s · Chốt', close('Xem là muốn có một cái liền.', 'Bấm vào link bên dưới để đặt nhé!'), closeShots)
  ]);

  // 4. Test thật tại kho
  add('Test thật tại kho', [
    scene(1, '0–10s · Hook test',
      hook([`${cap(G)} xem này, mình test thật ${name} ngay tại kho cho ${G} xem luôn.`], ['Không chỉnh sửa, không cắt ghép.', ...introPads, 'Xem tới cuối nhé.']),
      shots('Người dẫn đứng trong kho hàng của shop, kệ chất thùng hàng phía sau, cầm sản phẩm nói vào máy', 'đặt sản phẩm lên bàn thử', 'xắn tay áo chuẩn bị thử')),
    uspScene('10–20s · Test',
      fit([stepProof ? `Mình làm thử luôn: ${stepProof}.` : ''], [stepSay, featSay(f1, 'Thử thật mới thấy'), ...featurePads]),
      u => shots('Hai tay thử sản phẩm thật trên bàn, quay cận', `kết quả hiện rõ trước ống kính${u}`, 'người dẫn giơ kết quả về phía máy, gật gù')),
    scene(3, '20–30s · Kết luận', close('Test xong mình thấy ổn thật, đúng như mô tả.', 'Cần thì cứ chốt ở link bên dưới nhé!'), closeShots)
  ]);

  // 5. Hàng mới về & mở hộp
  add('Hàng mới về & mở hộp', [
    scene(1, '0–10s · Hàng về',
      hook([`${cap(G)} ơi, ${name} vừa về kho, mình mở luôn cho ${G} xem.`], [...introPads, 'Hộp đóng gói chắc chắn, giao tới vẫn nguyên vẹn.', 'Cùng xem bên trong có gì nhé.']),
      shots('Thùng hàng mới chất trong kho, người dẫn bê một hộp lên bàn, hào hứng nói vào máy', 'rọc băng keo mở thùng', 'lấy hộp sản phẩm ra giơ lên trước máy')),
    uspScene('10–20s · Bên trong',
      featureVoice('Mở ra là thấy ngay', [contents && `Bên trong gồm ${contents}.`]),
      u => shots('Góc nhìn từ trên xuống, hai tay mở nắp hộp', `bày từng món ra bàn${contents ? `: ${contents}` : ''}`, `cận cảnh chi tiết sản phẩm${u}`)),
    scene(3, '20–30s · Chốt', close('Đợt hàng này số lượng có hạn.', 'Ai cần cứ bấm link bên dưới nhé!'), closeShots)
  ]);

  // 6. Quà theo mùa / quà gia đình
  add(season ? `Quà ${season.name}` : 'Quà tặng gia đình', [
    scene(1, '0–10s · Hook cảm xúc',
      hook([season ? season.hook : 'Đang phân vân chọn quà cho người thân?', `Mình gợi ý ${name}.`],
        [...introPads, 'Món quà vừa đẹp vừa ý nghĩa, ai nhận cũng thích.', 'Xem cả nhà mình phản ứng thế nào nhé.']),
      shots(`${season ? season.setting : place}, người dẫn cầm hộp quà gói sẵn bước vào, mỉm cười ấm áp`, 'đặt hộp quà vào tay một người thân', 'người thân ngạc nhiên, bắt đầu mở quà')),
    uspScene('10–20s · Mở quà',
      featureVoice('Ai cũng thích', [pain && pain.kind === 'habit' && pain.gain ? `${cap(pain.gain)}.` : 'Cả nhà quây quần mở quà cùng nhau.']),
      u => shots('Gia đình người Việt quây quần mở quà, ánh sáng vàng ấm', `lấy sản phẩm ra cùng xem và cười vui${u}`, 'một em bé ôm sản phẩm khoe với máy')),
    scene(3, '20–30s · Ưu đãi & chốt',
      fit([season && shipSay ? shipSay : '', priceSay, 'Đặt sớm để kịp làm quà nhé!'], closePads),
      `Sản phẩm đặt nổi bật ${season ? season.spot : 'trên bàn gỗ trong phòng khách'}, ánh đèn ấm, máy tiến chậm vào sản phẩm rồi người dẫn bước vào khung hình nói lời chốt`)
  ]);

  // 7. Giá sốc / ưu đãi hôm nay
  add(noPrice ? 'Ưu đãi hôm nay' : 'Giá sốc hôm nay', [
    scene(1, '0–10s · Hook',
      hook([`Ai đang tìm ${kind} thì xem ngay video này!`],
        [!noPrice && deals.original && price && `Giá gốc ${deals.original.voice} mà hôm nay chỉ còn ${price.voice}.`, deals.discount && `Đợt này đang giảm tới ${deals.discount}%.`, ...introPads, 'Mình nói nhanh điểm hay cho mọi người.']),
      shots('Người dẫn giơ sản phẩm sát ống kính, nói nhanh dứt khoát', 'lùi ra cho thấy trọn sản phẩm trên tay, phía sau là kệ hàng của shop', 'tay gõ nhẹ lên hộp, cười tự tin')),
    uspScene('10–20s · Điểm mạnh', featureVoice('Điểm mình thích nhất là'),
      u => shots('Cận cảnh sản phẩm trên bàn, tay xoay chậm', `tay chỉ vào từng chi tiết${u}`, 'người dẫn gật đầu nói vào máy')),
    scene(3, '20–30s · Ưu đãi & chốt', close(noPrice ? 'Ưu đãi chỉ trong đợt này.' : 'Còn giá thì sao?', 'Bấm đặt hàng ngay dưới video nhé!'), closeShots)
  ]);

  // 8–9. Tay review không lời + nhạc nền theo mùa (mặc định nhạc Noel)
  const silent = { silent: true, style: HANDS_STYLE, audio: handsAudio(season ? season.tune : SEASONS[0].tune) };
  const bokeh = `phía sau mờ ảo là ${lowerFirst(place)}`;
  const spot = season ? season.spot : 'đúng chỗ dùng trong nhà';
  add('Tay review: lắp & bày (không lời)', [
    scene(1, '0–10s · Thành phẩm', '',
      shots(`Cận cảnh rất gần hai bàn tay nâng ${name} đã hoàn thiện, ${bokeh}`, `máy lia chậm qua thêm vài thành phẩm bày ${spot}`, 'hộp sản phẩm đặt trên bàn gỗ, hai tay bắt đầu mở nắp')),
    scene(2, '10–20s · Thao tác', '',
      shots(`Góc nhìn từ trên xuống bàn gỗ, hai tay bày ${contents || 'các món trong hộp'} ra`,
        `quay macro hai tay ${steps.length ? `làm lần lượt: ${steps.slice(0, 3).map(s => s.title).join(' → ')}` : 'thao tác sản phẩm từng bước'}`, 'thành phẩm hoàn chỉnh đặt giữa bàn, máy xoay chậm quanh')),
    scene(3, '20–30s · Thành quả', '',
      shots(`Hai tay đặt sản phẩm ${spot}`, 'máy lùi chậm ra thấy toàn cảnh, hộp sản phẩm đặt bên cạnh', 'khung hình đứng yên 2 giây cuối, ánh đèn lung linh'))
  ], silent);
  add('Tay review: mở hộp quà & chi tiết (không lời)', [
    scene(1, '0–10s · Mở quà', '',
      shots(`Hộp quà thắt nơ đỏ đặt ${spot}, ${bokeh}`, 'hai tay tháo nơ, mở nắp hộp', `hai tay nhấc ${name} ra, nâng lên trước ống kính`)),
    scene(2, '10–20s · Chi tiết', '',
      shots('Quay macro, hai tay xoay chậm sản phẩm dưới ánh đèn ấm', `ngón tay chỉ lần lượt vào từng chi tiết${highlights.length ? `: ${highlights.slice(0, 2).join('; ')}` : ''}`, 'tay thử dùng sản phẩm một lần, chuyển động mượt')),
    scene(3, '20–30s · Đặt vào chỗ', '',
      shots(`Hai tay đặt sản phẩm ${spot}, chỉnh lại cho ngay ngắn`, 'máy lùi chậm ra thấy toàn cảnh ấm cúng, hộp quà mở bên cạnh', 'khung hình đứng yên 2 giây cuối'))
  ], silent);

  for (const sc of scripts) {
    if (twoScenes) sc.scenes = [sc.scenes[0], sc.scenes[2]];
    sc.scenes.forEach((x, k) => Object.assign(x, {
      index: k + 1,
      time: x.time.replace(/^\d+–\d+s/, `${k * secs}–${(k + 1) * secs}s`),
      image: images[k] || images[0] || ''
    }));
  }

  return {
    productName,
    style: STYLE,
    facts: {
      name, price: price && price.label, original: deals.original && deals.original.label, discount: deals.discount,
      offers, highlights, season: season ? season.name : '', audience: G, delivery: deals.delivery,
      steps: steps.map(s => s.title), pain: pain ? pain.pain : '', noPrice
    },
    rawLines: [...new Set([...prices, ...policies].map(decode))],
    images: images.slice(0, 16),
    scripts
  };
}

module.exports = { generateScriptsFromProduct, speak, budgetFor, VOICE_MIN, VOICE_MAX };
