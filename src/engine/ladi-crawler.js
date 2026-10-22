'use strict'
// ladi-crawler.js — Scraper for LadiPage & E-commerce landing pages
// ECC Rule: Strict timeout, clean URL resolution, safe cheerio selectors

const cheerio = require('cheerio')

/**
 * Fetches HTML from a given URL with redirect and timeout handling.
 * @param {string} url
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<string>}
 */
async function fetchHtml(url, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Extracts product images from HTML (img tags, data-src, background-image).
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
function extractImages(html, baseUrl = '') {
  const $ = cheerio.load(html)
  const set = new Set()

  const resolve = (u) => {
    if (!u) return null
    try {
      return new URL(u.trim(), baseUrl || 'https://localhost').href
    } catch {
      return null
    }
  }

  // 1. <img> src and data-src
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original')
    const full = resolve(src)
    if (full && !full.startsWith('data:') && !full.includes('icon') && !full.includes('logo')) {
      set.add(full)
    }
  })

  // 2. CSS background-image
  $('[style*="background"]').each((_, el) => {
    const style = $(el).attr('style') || ''
    const match = style.match(/url\(['"]?([^'")]+)['"]?\)/i)
    if (match && match[1]) {
      const full = resolve(match[1])
      if (full && !full.startsWith('data:')) {
        set.add(full)
      }
    }
  })

  return Array.from(set)
}

/**
 * Extracts product title, prices, and benefits from landing page HTML.
 * @param {string} html
 * @returns {{ title: string, price: string, benefits: string }}
 */
function extractText(html) {
  const $ = cheerio.load(html)

  // 1. Title
  let title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    'Sản phẩm mới'

  // Clean title (remove trailing site names)
  title = title.split(/[-–|]/)[0].trim()

  // 2. Price
  let price = ''
  const priceRegex = /(\d{1,3}(?:\.\d{3})+|\d{1,3}k)\s*(?:đ|d|đồng|vnd)?/i

  // Look for elements with price in class or text
  $('[class*="price"], [id*="price"], span, strong, b').each((_, el) => {
    if (price) return
    const text = $(el).text().trim()
    const match = text.match(priceRegex)
    if (match && !text.includes('100%')) {
      price = match[0]
    }
  })

  // 3. Benefits / Descriptions
  const benefits = []
  $('p, li, .desc, .description').each((_, el) => {
    if (benefits.length >= 3) return
    const text = $(el).text().trim()
    if (text.length > 20 && text.length < 150) {
      benefits.push(text)
    }
  })

  return {
    title,
    price,
    benefits: benefits.join('. '),
  }
}

/**
 * Main scrape function.
 * @param {string} url
 * @returns {Promise<{ url: string, title: string, price: string, benefits: string, images: string[] }>}
 */
async function scrapeLadiPage(url) {
  const html = await fetchHtml(url)
  const textData = extractText(html)
  const images = extractImages(html, url)

  return {
    url,
    title: textData.title,
    price: textData.price,
    benefits: textData.benefits,
    images: images.slice(0, 15), // Top 15 images
  }
}

module.exports = {
  fetchHtml,
  extractImages,
  extractText,
  scrapeLadiPage,
}
