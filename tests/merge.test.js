'use strict'
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { getFfmpegPath, mergeScenes } = require('../src/engine/merge')

describe('Merge Engine (FFmpeg)', () => {
  it('locates bundled ffmpeg binary', () => {
    const ffmpegPath = getFfmpegPath()
    assert.ok(fs.existsSync(ffmpegPath), `Expected ${ffmpegPath} to exist`)
  })

  it('rejects empty video array', async () => {
    await assert.rejects(
      () => mergeScenes([], 'output.mp4'),
      /non-empty array/
    )
  })
})
