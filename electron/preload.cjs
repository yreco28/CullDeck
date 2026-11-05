'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

const api = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  pickFolder: () => ipcRenderer.invoke('app:pick-folder'),
  pathInfo: (target) => ipcRenderer.invoke('app:path-info', target),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  },
  scan: (roots) => ipcRenderer.invoke('app:scan', roots),
  cancelScan: () => ipcRenderer.invoke('app:cancel-scan'),
  saveSettings: (patch) => ipcRenderer.invoke('app:save-settings', patch),
  addSession: (session) => ipcRenderer.invoke('app:add-session', session),
  resetStats: () => ipcRenderer.invoke('app:reset-stats'),
  saveReview: (payload) => ipcRenderer.invoke('app:save-review', payload),
  clearReview: (payload) => ipcRenderer.invoke('app:clear-review', payload),
  getReview: (roots) => ipcRenderer.invoke('app:get-review', roots),
  reviewSessions: () => ipcRenderer.invoke('app:review-sessions'),
  dropSessions: (keys) => ipcRenderer.invoke('app:drop-sessions', keys),
  replaceRoot: (from, to) => ipcRenderer.invoke('app:replace-root', { from, to }),
  setKept: (paths, keep) => ipcRenderer.invoke('app:set-kept', paths, keep),

  thumb: (file, size) => ipcRenderer.invoke('media:thumb', file, size),
  thumbs: (files, size) => ipcRenderer.invoke('media:thumbs', files, size),
  meta: (file) => ipcRenderer.invoke('media:meta', file),
  trash: (files) => ipcRenderer.invoke('media:trash', files),
  destroy: (files) => ipcRenderer.invoke('media:delete', files),
  thumbStats: () => ipcRenderer.invoke('app:thumb-stats'),
  clearThumbs: () => ipcRenderer.invoke('app:clear-thumbs'),

  reveal: (file) => ipcRenderer.invoke('shell:reveal', file),
  openFile: (file) => ipcRenderer.invoke('shell:open', file),

  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximized: (callback) => {
      const handler = (_event, value) => callback(value)
      ipcRenderer.on('win:maximized', handler)
      return () => ipcRenderer.removeListener('win:maximized', handler)
    }
  },

  onScanProgress: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },

  mediaUrl: (file) => `media://local/${encodeURIComponent(file)}`
}

contextBridge.exposeInMainWorld('api', api)
