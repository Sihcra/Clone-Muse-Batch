'use strict'
// product-ai.js — 3-scene x 10s script generator & TTS word fitting
// ECC Rule: Strict TTS budget, text normalization without regex catastrophic backtracking

const {
  TTS_MIN_WORDS,
  TTS_MAX_WORDS,
  SCENE_COUNT,
  SCENE_DURATION_SEC,
} = require('./constants')

// Simple number-to-words for common price ranges
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

function numberToVietnameseWords(num) {
  const n = parseInt(num, 10)
  if (isNaN(n) || n < 0) return ''
  if (n < 10) return DIGITS[n]

  if (n >= 100 && n < 1000) {
    const hundreds = Math.floor(n / 100)
    const rem = n % 100
    if (rem === 0) return `${DIGITS[hundreds]} trăm`
    if (rem < 10) return `${DIGITS[hundreds]} trăm linh ${DIGITS[rem]}`
    return `${DIGITS[hundreds]} trăm ${numberToVietnameseWords(rem)}`
  }

  if (n >= 10 && n < 100) {
    const tens = Math.floor(n / 10)
    const units = n % 10
    const tenWord = tens === 1 ? 'mười' : `${DIGITS[tens]} mươi`
    if (units === 0) return tenWord
    if (units === 1 && tens > 1) return `${tenWord} mốt`
    if (units === 5) return `${tenWord} lăm`
    return `${tenWord} ${DIGITS[units]}`
  }

  return num.toString()
}

/**
 * Normalizes text for Vietnamese Text-To-Speech.
 * @param {string} text
 * @returns {string}
 */
function speak(text) {
  if (!text) return ''

  let s = text
    // Replace emoji and non-standard symbols
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // Replace price forms like '250.000đ', '250.000 đ', '250000đ', '250000 vnd'
    .replace(/\b(\d{1,3})\.?000\s*(?:đ|d|đồng|dong|vnd)/gi, (_, n) => {
      const words = numberToVietnameseWords(n)
      return `${words} nghìn đồng`
    })
    // Replace price forms like '199k' -> 'một trăm chín mươi chín nghìn đồng'
    .replace(/\b(\d{1,3})k\b/gi, (_, n) => {
      const words = numberToVietnameseWords(n)
      return `${words} nghìn đồng`
    })
    // Clean multiple spaces and exclamation marks
    .replace(/!{2,}/g, '!')
    .replace(/\s+/g, ' ')
    .trim()

  return s
}

/**
 * Fits or truncates text to match the TTS word budget (40 to 46 words).
 * @param {string} text
 * @param {number} [minWords=TTS_MIN_WORDS]
 * @param {number} [maxWords=TTS_MAX_WORDS]
 * @returns {string}
 */
function fitScript(text, minWords = TTS_MIN_WORDS, maxWords = TTS_MAX_WORDS) {
  const words = speak(text).split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) {
    return words.join(' ')
  }
  return words.slice(0, maxWords).join(' ')
}

/**
 * Generates 3 video scenes tailored to e-commerce UGC style.
 * @param {{
 *   title: string,
 *   price?: string,
 *   benefits?: string,
 *   angle?: 'problem_solution' | 'before_after' | 'unboxing',
 *   style?: string
 * }} opts
 * @returns {{ scenes: Array<{ sceneIndex: number, duration: number, visualPrompt: string, prompt: string, tts: string }> }}
 */
function generateScript({ title, price = '', benefits = '', angle = 'problem_solution', style = 'real_person' }) {
  const normTitle = title.trim()
  const normPrice = speak(price)
  const normBenefits = speak(benefits)

  const scenes = [
    {
      sceneIndex: 1,
      duration: SCENE_DURATION_SEC,
      visualPrompt: `Close-up shot of a person using ${normTitle}, natural indoor lighting, cinematic photorealistic quality, 9:16 aspect ratio`,
      prompt: `Cận cảnh người thật cầm và trải nghiệm ${normTitle}, phong cách đời thường tự nhiên`,
      tts: fitScript(`Bạn đang gặp rắc rối và mệt mỏi mỗi khi giải quyết công việc này? Đừng lo, đây chính là giải pháp cứu cánh tuyệt vời dành riêng cho bạn`),
    },
    {
      sceneIndex: 2,
      duration: SCENE_DURATION_SEC,
      visualPrompt: `Product demonstration highlighting features of ${normTitle}, showing smooth operation and benefits, realistic camera angle`,
      prompt: `Trình diễn tính năng chính của ${normTitle}, ${normBenefits}, camera quay mượt mà góc nhìn thực tế`,
      tts: fitScript(`Với ${normTitle}, mọi chuyện trở nên cực kỳ đơn giản và nhanh gọn. ${normBenefits || 'Chất lượng hoàn thiện cực tốt, thiết kế thông minh hiện đại'}`),
    },
    {
      sceneIndex: 3,
      duration: SCENE_DURATION_SEC,
      visualPrompt: `Satisfied customer holding ${normTitle} with smiling face, special discount tag visible, call to action`,
      prompt: `Khách hàng hài lòng cầm ${normTitle}, kêu gọi hành động đặt hàng ngay`,
      tts: fitScript(`Đặc biệt ưu đãi giá chỉ ${normPrice || 'cực kỳ hấp dẫn'} ngay hôm nay, số lượng có hạn, bấm vào giỏ hàng đặt ngay để nhận quà tặng kèm`),
    },
  ]

  return { scenes }
}

module.exports = {
  speak,
  fitScript,
  generateScript,
}
