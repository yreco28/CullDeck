'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const exifr = require('exifr')

const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.avif', '.tif', '.tiff', '.jfif'])
const VIDEO = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp'])
const SKIP_DIRS = new Set([
  'node_modules', '$recycle.bin', 'system volume information', '.git', '.svn',
  'appdata', 'windows', 'program files', 'program files (x86)', 'programdata'
])

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.heic': 'image/heic', '.heif': 'image/heif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.3gp': 'video/3gpp'
}

class ScanCancelledError extends Error {
  constructor() {
    super('SCAN_CANCELLED')
    this.code = 'SCAN_CANCELLED'
  }
}

function kindOf(ext) {
  if (IMAGE.has(ext)) return 'image'
  if (VIDEO.has(ext)) return 'video'
  return null
}

async function walk(root, onProgress, shouldStop) {
  const out = []
  const stack = [root]
  while (stack.length) {
    if (shouldStop && shouldStop()) throw new ScanCancelledError()
    const dir = stack.pop()
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (shouldStop && shouldStop()) throw new ScanCancelledError()
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      const kind = kindOf(ext)
      if (!kind) continue
      let stat
      try {
        stat = await fsp.stat(full)
      } catch {
        continue
      }
      if (stat.size === 0) continue
      out.push({
        id: full,
        path: full,
        name: entry.name,
        ext,
        kind,
        size: stat.size,
        mtime: stat.mtimeMs,
        takenAt: stat.mtimeMs,
        album: path.relative(root, dir) || path.basename(root)
      })
    }
    if (onProgress) onProgress(out.length)
  }
  return out
}

async function pool(items, limit, worker, shouldStop) {
  let cursor = 0
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      if (shouldStop && shouldStop()) throw new ScanCancelledError()
      const index = cursor++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

/**
 * Scan a folder for media. Fills takenAt from EXIF where possible.
 * `getCachedDate(item)` / `setCachedDate(item, timestamp)` let the caller keep
 * an incremental metadata cache so repeated launches do not re-parse EXIF.
 */
async function scanFolder(root, options = {}) {
  const started = Date.now()
  const onProgress = options.onProgress || null
  const shouldStop = options.shouldStop || null
  const items = await walk(root, onProgress ? (n) => onProgress({ phase: 'walk', count: n }) : null, shouldStop)
  const wanted = items.filter((item) => options.showVideos !== false || item.kind === 'image')

  let done = 0
  await pool(
    wanted,
    8,
    async (item) => {
      if (item.kind === 'image') {
        const cached = options.getCachedDate ? options.getCachedDate(item) : null
        if (Number.isFinite(cached)) {
          item.takenAt = cached
        } else {
          try {
            const meta = await exifr.parse(item.path, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] })
            const date = meta && (meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate)
            if (date instanceof Date && !Number.isNaN(date.getTime())) item.takenAt = date.getTime()
          } catch {
            /* not all files have EXIF */
          }
          if (options.setCachedDate) options.setCachedDate(item, item.takenAt)
        }
      }
      done += 1
      if (onProgress && done % 25 === 0) onProgress({ phase: 'exif', count: done, total: wanted.length })
    },
    shouldStop
  )

  if (shouldStop && shouldStop()) throw new ScanCancelledError()
  if (onProgress) onProgress({ phase: 'exif', count: wanted.length, total: wanted.length })
  wanted.sort((a, b) => b.takenAt - a.takenAt)

  return {
    root,
    items: wanted,
    scannedAt: Date.now(),
    elapsed: Date.now() - started
  }
}

module.exports = { scanFolder, MIME, kindOf, IMAGE, VIDEO, ScanCancelledError }
