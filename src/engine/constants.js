// Central constants — no magic numbers anywhere else in the codebase
'use strict'

module.exports = {
  // Task store
  MAX_TASKS: 500,
  TASK_IMAGES_DIR: 'task-images',

  // Anti-ban jitter (ms)
  ANTI_BAN_MIN_MS: 15_000,
  ANTI_BAN_MAX_MS: 20_000,

  // Pool pump
  PUMP_INTERVAL_MS: 3_000,

  // Login check
  CHECK_LOGIN_RETRIES: 20,
  CHECK_LOGIN_INTERVAL_MS: 3_000,

  // CDP
  CDP_PORT_BASE: 9222,

  // CRM server
  CRM_PORT: 48900,
  CRM_HOST: '127.0.0.1',

  // File download chunking
  CHUNK_SIZE_BYTES: 2 * 1024 * 1024, // 2 MB

  // TTS budget
  TTS_WORDS_PER_SEC: 4.6,
  SCENE_DURATION_SEC: 10,
  TTS_MIN_WORDS: 40,
  TTS_MAX_WORDS: 46,
  SCENE_COUNT: 3,

  // Quota refresh
  QUOTA_REFRESH_INTERVAL_MS: 5 * 60_000, // 5 min

  // Accounts
  DEFAULT_ACCOUNT_ID: 'default',
  DEFAULT_SETTINGS: {
    maxAccounts: 2,
    totalThreads: 2,
    mode: 'rotate',      // 'rotate' | 'stack'
    keepGoing: false,
    useTopup: true,
    proxies: '',
    usePool: false,
  },
}
