'use strict';
/**
 * LADIPAGE CRAWLER — tải HTML trang bán hàng, bóc ảnh gốc (CDN), dòng giá, chính sách và các dòng chữ để sinh kịch bản.
 */

const https = require('https');
const http = require('http');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function fetchHtml(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('Chuyển hướng quá nhiều lần'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'vi,en;q=0.9' }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchHtml(new URL(res.headers.location, url).href, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP Error ${res.statusCode}`));
      }
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ html: data, finalUrl: url }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Hết thời gian chờ kết nối (Timeout 15s)')));
  });
}

// Gốc để ghép link ảnh tương đối: ưu tiên <base href>, path không có đuôi file thì coi là thư mục
function baseUrlOf(url, html = '') {
  const m = /<base[^>]+href=["']([^"']+)["']/i.exec(html);
  if (m) { try { return new URL(m[1], url).href; } catch {} }
  try {
    const u = new URL(url);
    if (!u.pathname.endsWith('/') && !path.extname(u.pathname)) u.pathname += '/';
    return u.href;
  } catch {
    return url.endsWith('/') ? url : url + '/';
  }
}

function isProductImage(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:image')) return false;
  if (/icon|logo|badge|avatar|star|pixel|spacer|arrow|svg|loading/i.test(url)) return false;
  return /\.(jpg|jpeg|png|webp|avif)/i.test(url) || url.includes('ladicdn.com') || url.includes('static.ladipage');
}

function absUrl(url, base) {
  if (url.startsWith('//')) return 'https:' + url;
  if (/^https?:/i.test(url)) return url;
  try { return new URL(url, base).href; } catch { return url; }
}

function extractImages(html, base) {
  const found = new Set();
  const patterns = [
    /<img[^>]+(?:src|data-src|data-original)=["']([^"']+)["']/gi,
    /background(?:-image)?:\s*url\(['"]?([^'")]+)['"]?\)/gi, // LadiPage dùng nhiều div.ladi-image-background
    /data-background-image=["']([^"']+)["']/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) {
      const src = m[1].trim();
      if (isProductImage(src)) found.add(absUrl(src, base));
    }
  }
  return [...found];
}

const stripBlocks = html => html
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');

function extractTexts(html) {
  const lines = [];
  const re = />([^<]+)</g;
  const clean = stripBlocks(html);
  let m;
  while ((m = re.exec(clean))) {
    const t = m[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > 2 && t.length < 500) lines.push(t);
  }
  return lines;
}

const PRICE_LINE = /(\b\d{1,3}(?:[.,]\d{3})+(?:\s*(?:đ|vnđ|k|đồng))|\b\d{2,4}\s*(?:k|vnđ|đ)\b)/i;
const extractPricing = lines => [...new Set(lines.filter(l => PRICE_LINE.test(l) && l.length < 100))].slice(0, 8);

const POLICY = [/miễn\s*phí\s*vận\s*chuyển/i, /freeship/i, /kiểm\s*tra\s*hàng/i, /đồng\s*kiểm/i, /thanh\s*toán\s*khi\s*nhận/i,
  /đổi\s*trả/i, /bảo\s*hành/i, /cam\s*kết/i, /hoàn\s*tiền/i, /quà\s*tặng/i];
const extractPolicies = lines => [...new Set(lines.filter(l => l.length < 150 && POLICY.some(re => re.test(l))))].slice(0, 6);

function parsePage(html, url) {
  const t = /<title>([^<]+)<\/title>/i.exec(html);
  const lines = extractTexts(html);
  return {
    url,
    title: t ? t[1].trim() : 'Sản phẩm LadiPage',
    images: extractImages(html, baseUrlOf(url, html)).slice(0, 24),
    prices: extractPricing(lines),
    policies: extractPolicies(lines),
    textSnippet: lines.slice(0, 100).join('\n')
  };
}

async function scrapeLadiPage(url) {
  const { html, finalUrl } = await fetchHtml(url);
  return { ...parsePage(html, finalUrl || url), url };
}

module.exports = { scrapeLadiPage, parsePage, extractImages, extractTexts, baseUrlOf };
