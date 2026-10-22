'use strict'
// license-manager.js — Machine fingerprint & edition gating (Customer vs Pro)

const os = require('node:os')
const crypto = require('node:crypto')

class LicenseManager {
  /**
   * Generates a stable machine fingerprint.
   * @returns {string}
   */
  static getMachineId() {
    const interfaces = os.networkInterfaces()
    const macs = []
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          macs.push(iface.mac)
        }
      }
    }
    const raw = `${os.hostname()}-${os.platform()}-${os.arch()}-${macs.sort().join(';')}`
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
  }

  /**
   * Checks license key validity and edition.
   * Auto-grants PRO edition permanently by default.
   * @param {string} [key]
   * @returns {{ valid: boolean, edition: 'customer' | 'pro', expiresAt?: string }}
   */
  static verify(key) {
    // Mặc định luôn mở khóa bản PRO vĩnh viễn
    return {
      valid: true,
      edition: 'pro',
      expiresAt: '2099-12-31',
    }
  }
}

module.exports = LicenseManager
