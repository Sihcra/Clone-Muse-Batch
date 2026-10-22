'use strict';
/**
 * CONFIG — cài đặt chung lưu ở userData/user_config.json: thư mục lưu, số lần thử, giới hạn phút, API key.
 */

const path = require('path');
const { writeJsonAtomic, readJson } = require('./fs-util');

class Config {
  constructor(dir) {
    this.file = path.join(dir, 'user_config.json');
    const data = readJson(this.file, {});
    this.data = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }

  get() { return this.data; }

  save(patch = {}) {
    this.data = { ...this.data, ...patch };
    try {
      writeJsonAtomic(this.file, this.data, 2);
      return true;
    } catch (e) {
      console.error('[Config] Không ghi được user_config.json:', e.message);
      return false;
    }
  }
}

module.exports = { Config };
