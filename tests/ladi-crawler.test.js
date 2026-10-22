'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { extractImages, extractText } = require('../src/engine/ladi-crawler')

describe('LadiPage Crawler (Cheerio Parsing)', () => {
  const sampleHtml = `
    <html>
      <head>
        <title>Nồi Chiên Không Dầu Cao Cấp 10L - Giảm 50%</title>
      </head>
      <body>
        <h1 class="product-title">Nồi Chiên Không Dầu Thông Minh 10L</h1>
        <div class="price-box">
          <span class="sale-price">499.000đ</span>
          <span class="old-price">1.200.000đ</span>
        </div>
        <img src="https://example.com/img1.jpg" alt="product 1">
        <img data-src="https://example.com/img2.png" alt="product 2">
        <div style="background-image: url('https://example.com/bg.jpg')"></div>
        <p class="description">Dung tích lớn nướng cả con gà, chống dính ceramic an toàn cho sức khỏe</p>
      </body>
    </html>
  `

  it('extracts images from src, data-src, and CSS background-image', () => {
    const images = extractImages(sampleHtml, 'https://example.com')
    assert.ok(images.includes('https://example.com/img1.jpg'))
    assert.ok(images.includes('https://example.com/img2.png'))
    assert.ok(images.includes('https://example.com/bg.jpg'))
  })

  it('extracts title and price correctly from HTML', () => {
    const data = extractText(sampleHtml)
    assert.match(data.title, /Nồi Chiên Không Dầu/)
    assert.match(data.price, /499\.000/)
    assert.ok(data.benefits.length > 0)
  })
})
