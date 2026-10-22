'use strict'
// merge.js — Video stitching and normalization using bundled static FFmpeg
// ECC Rule: Strict cleanup in finally block, explicit error propagation

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

/**
 * Resolves the path to the bundled ffmpeg binary.
 * @returns {string}
 */
function getFfmpegPath() {
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const bundledPath = path.join(__dirname, '..', '..', 'resources', 'bin', binaryName)

  if (fs.existsSync(bundledPath)) {
    return bundledPath
  }
  // Fallback to system PATH if not found in resources
  return binaryName
}

/**
 * Merges multiple video files sequentially into a single video file.
 * @param {string[]} videoPaths
 * @param {string} outputPath
 * @param {{ ratio?: '9:16' | '16:9' }} [options]
 * @returns {Promise<string>}
 */
async function mergeScenes(videoPaths, outputPath, options = {}) {
  if (!Array.isArray(videoPaths) || videoPaths.length === 0) {
    throw new Error('videoPaths must be a non-empty array of file paths')
  }

  // If only 1 video and no transformation needed, simply copy or return it
  if (videoPaths.length === 1 && !options.ratio) {
    fs.copyFileSync(videoPaths[0], outputPath)
    return outputPath
  }

  const ffmpegPath = getFfmpegPath()
  const concatListPath = path.join(
    os.tmpdir(),
    `musebatch_concat_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`
  )

  try {
    // Generate concat playlist (paths escaped for ffmpeg)
    const fileListContent = videoPaths
      .map(p => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n')

    fs.writeFileSync(concatListPath, fileListContent, 'utf8')

    const args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ]

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''

      proc.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })

      proc.on('close', code => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`))
        }
      })

      proc.on('error', err => {
        reject(new Error(`Failed to start FFmpeg: ${err.message}`))
      })
    })

    return outputPath
  } finally {
    // Always clean up temporary playlist file
    try {
      if (fs.existsSync(concatListPath)) {
        fs.unlinkSync(concatListPath)
      }
    } catch {}
  }
}

module.exports = {
  getFfmpegPath,
  mergeScenes,
}
