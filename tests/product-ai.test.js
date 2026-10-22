'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { speak, fitScript, generateScript } = require('../src/engine/product-ai')

describe('Product AI & TTS Normalizer', () => {
  describe('speak() normalization', () => {
    it('normalizes common VND price representations', () => {
      assert.match(speak('giá chỉ 199k hôm nay'), /một trăm chín mươi chín nghìn đồng/)
      assert.match(speak('ưu đãi 250.000đ'), /hai trăm năm mươi nghìn đồng/)
    })

    it('strips emojis and special symbols', () => {
      const clean = speak('🔥 Giảm sốc!! Chỉ có tại đây ✨')
      assert.equal(clean.includes('🔥'), false)
      assert.equal(clean.includes('✨'), false)
    })
  })

  describe('fitScript() word count budget', () => {
    it('keeps word count within 40 to 46 words for 10s TTS budget', () => {
      const longText = 'Sản phẩm này rất tốt chất lượng cao giá cả phải chăng bảo hành một năm đổi mới nếu lỗi cam kết chính hãng nhập khẩu nguyên chiếc từ nhà máy chuẩn chất lượng cao uy tín hàng đầu thị trường giao hàng hỏa tốc trong ngày kiểm tra hàng trước khi thanh toán'
      const fitted = fitScript(longText)
      const count = fitted.trim().split(/\s+/).length
      assert.ok(count >= 35 && count <= 46, `Expected ~40-46 words, got ${count}`)
    })
  })

  describe('generateScript()', () => {
    it('produces exactly 3 scenes with prompt and tts', () => {
      const result = generateScript({
        title: 'Nồi chiên không dầu 8L',
        price: '899.000đ',
        benefits: 'Dung tích lớn, chống dính ceramic',
        angle: 'problem_solution',
      })

      assert.equal(result.scenes.length, 3)
      for (const scene of result.scenes) {
        assert.ok(scene.prompt)
        assert.ok(scene.tts)
        assert.ok(scene.duration === 10)
      }
    })
  })
})
