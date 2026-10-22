'use strict';
// Ghi file tạm rồi đổi tên: tắt app giữa lúc ghi không làm hỏng file JSON đang có.
const fs = require('fs');

function writeJsonAtomic(file, data, indent) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, indent === undefined ? JSON.stringify(data) : JSON.stringify(data, null, indent));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

module.exports = { writeJsonAtomic, readJson };
