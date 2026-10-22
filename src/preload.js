'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Thanh tiêu đề theo hệ điều hành (Windows chừa chỗ 3 nút bên phải, Mac chừa đèn bên trái)
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.os = process.platform;
});

const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const on = channel => cb => ipcRenderer.on(channel, (_e, value) => cb(value));

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: invoke('open-external'),
  openOutputFolder: invoke('open-output-folder'),
  getAppConfig: invoke('get-app-config'),
  scrapeAndAnalyzeLadi: invoke('scrape-and-analyze-ladi'),
  selectImageFile: invoke('select-image-file'),
  queueLoad: invoke('queue-load'),
  queueSave: invoke('queue-save'),
  fetchImageBase64: invoke('fetch-image-base64'),
  mergeVideos: invoke('merge-videos'),
  addMusic: invoke('add-music'),
  openMusicFolder: invoke('open-music-folder'),
  getStudio: invoke('studio-get'),
  saveStudio: invoke('studio-save'),
  addStudioImage: invoke('studio-add-image'),
  addProject: invoke('project-add'),
  updateProject: invoke('project-update'),
  setProject: invoke('project-current'),
  removeProject: invoke('project-remove'),
  submitTask: invoke('task-submit'),
  listTasks: invoke('task-list'),
  cancelTask: invoke('task-cancel'),
  retryTask: invoke('task-retry'),
  removeTask: invoke('task-remove'),
  resumeTasks: invoke('task-resume'),
  clearFinishedTasks: invoke('task-clear-finished'),
  runTasks: invoke('task-run'),
  stopAllTasks: invoke('task-stop-all'),
  revealFile: invoke('reveal-file'),
  getApiKey: invoke('get-api-key'),
  listAccounts: invoke('accounts-list'),
  addAccount: invoke('account-add'),
  updateAccount: invoke('account-update'),
  removeAccount: invoke('account-remove'),
  loginAccount: invoke('account-login'),
  showAccount: invoke('account-show'),
  logoutAccount: invoke('account-logout'),
  saveAccountSettings: invoke('accounts-settings'),
  checkQuota: invoke('accounts-check-quota'),
  checkProxies: invoke('proxies-check'),
  checkLogins: invoke('accounts-check-login'),
  listLibrary: invoke('list-library'),
  trashFiles: invoke('trash-files'),
  getSettings: invoke('get-settings'),
  saveSettings: invoke('save-settings'),
  selectFolder: invoke('select-folder'),

  onStatusUpdate: on('status-update'),
  onVideoCompleted: on('video-completed'),
  onTaskUpdate: on('task-update'),
  onStudioUpdate: on('studio-update'),
  onMergeProgress: on('merge-progress'),
  onAccountsUpdate: on('accounts-update'),
  onCrmJobReceived: on('crm-job-received')
});
