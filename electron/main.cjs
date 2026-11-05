'use strict'

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeImage, Menu, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const exifr = require('exifr')
const { Readable } = require('node:stream')
const { fileURLToPath } = require('node:url')
const { scanFolder, MIME } = require('./lib/scan.cjs')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5199'

const DEFAULTS = {
  theme: 'dark',
  lang: 'tr',
  swipe: 'left-delete',
  deleteMode: 'trash',
  gridSize: 'medium',
  rootFolders: [],
  showVideos: true,
  volume: 1,
  muted: false,
  soundEffects: true,
  window: { width: 1320, height: 860, x: null, y: null, maximized: false }
}

/* ---------- tek seferlik veri taşıma (Sponge → CullDeck) ---------- */

const LEGACY_APP_NAME = 'Sponge'
const LEGACY_ENTRIES = [
  'settings.json',
  'stats.json',
  'reviews.json',
  'kept.json',
  'meta.json',
  'review.json',
  'libraries',
  'thumbs'
]
const MIGRATION_MARKER = '.migrated-from-sponge'

function migrateLegacyUserData() {
  try {
    const target = app.getPath('userData')
    const legacy = path.join(app.getPath('appData'), LEGACY_APP_NAME)
    const defaultTarget = path.join(app.getPath('appData'), app.getName())
    if (path.resolve(target) !== path.resolve(defaultTarget)) return
    if (path.resolve(target) === path.resolve(legacy)) return
    if (!fs.existsSync(legacy)) return
    if (fs.existsSync(path.join(target, MIGRATION_MARKER))) return

    fs.mkdirSync(target, { recursive: true })
    let copied = 0
    for (const name of LEGACY_ENTRIES) {
      const from = path.join(legacy, name)
      const to = path.join(target, name)
      if (!fs.existsSync(from) || fs.existsSync(to)) continue
      fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
      copied += 1
    }

    fs.writeFileSync(path.join(target, MIGRATION_MARKER), `${new Date().toISOString()}\n`)
    if (copied) console.log(`[migrate] ${copied} öğe kopyalandı: ${legacy} -> ${target}`)
  } catch (error) {
    console.error('[migrate] eski veri taşınamadı:', error)
  }
}

migrateLegacyUserData()

let mainWindow = null
let settings = { ...DEFAULTS }
let stats = { sessions: [] }
let reviews = {}
let kept = new Set()
let metaCache = {}
let metaDirty = false
let scanState = null
const thumbMemo = new Map()
const exifMemo = new Map()
let keptTimer = null

/* SÄ±nÄ±rsÄ±z bÃ¼yÃ¼meyi Ã¶nle: en eski kayÄ±tlar atÄ±lÄ±r (LRU benzeri, ekleme sÄ±rasÄ±). */
function memoSet(map, key, value, limit) {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  while (map.size > limit) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function rootsOf(value) {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list.filter(Boolean)
}

function normalizePath(value) {
  return String(value || '').replace(/[\\/]+$/, '').toLowerCase()
}

/* ---------- security helpers ---------- */

const APP_INDEX = path.join(__dirname, '..', 'dist', 'index.html')

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl)
  } catch {
    return null
  }
}

/* Only the app's own document is trusted: dist/index.html in production,
   the Vite dev server origin in development. */
function isTrustedFrameUrl(rawUrl) {
  const url = parseUrl(rawUrl)
  if (!url) return false
  if (isDev) {
    const dev = parseUrl(DEV_URL)
    return Boolean(dev) && url.origin === dev.origin
  }
  if (url.protocol !== 'file:') return false
  try {
    return normalizePath(fileURLToPath(url)) === normalizePath(APP_INDEX)
  } catch {
    return false
  }
}

function isTrustedSender(event) {
  const frame = event?.senderFrame
  if (!frame || frame.parent) return false
  return isTrustedFrameUrl(frame.url)
}

const ipcRegister = ipcMain.handle.bind(ipcMain)

/* Single choke point for every IPC endpoint: calls coming from an untrusted
   frame are rejected without returning any data. */
function ipcHandle(channel, listener) {
  ipcRegister(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('UNTRUSTED_SENDER')
    return listener(event, ...args)
  })
}

/* External links may only be opened over https. */
function isSafeExternalUrl(rawUrl) {
  const url = parseUrl(rawUrl)
  return Boolean(url) && url.protocol === 'https:'
}

function isInsideResolved(file, root) {
  if (typeof file !== 'string' || !file) return false
  const target = path.resolve(file)
  const base = path.resolve(root)
  const rel = path.relative(base, target)
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

function isUnderAnyRoot(file) {
  return rootsOf(settings.rootFolders).some((root) => isInsideResolved(file, root))
}

function isMediaFile(file) {
  return Boolean(MIME[path.extname(String(file || '')).toLowerCase()])
}

/* Media protocol / thumbnails may only touch scanned roots and the app's own
   thumbnail cache, never an arbitrary path. */
function isAllowedMediaFile(file) {
  return isUnderAnyRoot(file) || isInsideResolved(file, thumbDir())
}

/* KÃ¶k klasÃ¶rÃ¼n "canlÄ±" olup olmadÄ±ÄŸÄ±nÄ± denetle: yolu var mÄ±, klasÃ¶r mÃ¼,
   okunabiliyor mu. Tarama sÄ±rasÄ±nda sessizce 0 Ã¶ÄŸe dÃ¶nmesi yerine
   kullanÄ±cÄ±ya aÃ§Ä±k bir neden gÃ¶sterebilmek iÃ§in kullanÄ±lÄ±r. */
async function checkRootPath(target) {
  try {
    const stat = await fsp.stat(target)
    if (!stat.isDirectory()) return { path: target, ok: false, reason: 'not-directory' }
    try {
      await fsp.readdir(target)
    } catch {
      return { path: target, ok: false, reason: 'unreadable' }
    }
    return { path: target, ok: true, reason: null }
  } catch (error) {
    const code = error?.code || ''
    const reason = code === 'EACCES' || code === 'EPERM' ? 'unreadable' : 'missing'
    return { path: target, ok: false, reason }
  }
}

async function checkRoots(roots) {
  return Promise.all(rootsOf(roots).map((root) => checkRootPath(root)))
}

/* ---------- bozuk kÃ¶k yolu dÃ¼zeltme: kayÄ±t taÅŸÄ±ma ---------- */

const stripTrailingSep = (value) => String(value || '').replace(/[\\/]+$/, '')

/* Dosya belirtilen kÃ¶kÃ¼n altÄ±nda mÄ± (bÃ¼yÃ¼klÃ¼k duyarsÄ±z). */
function isUnderPath(file, root) {
  const f = normalizePath(file)
  const r = normalizePath(root)
  return !!f && !!r && (f === r || f.startsWith(`${r}${path.sep}`))
}

/* Eski kÃ¶kÃ¼n altÄ±ndaki yolu (Ã¶nek dahil hiyerarÅŸi korunarak) yeni kÃ¶kle deÄŸiÅŸtirir;
   altÄ±ndaki deÄŸilse dokunmaz. */
function remapPath(file, from, to) {
  if (!isUnderPath(file, from)) return file
  return `${stripTrailingSep(to)}${String(file).slice(stripTrailingSep(from).length)}`
}

/* Session key = the set of root folders a review belongs to.
   The same folder set always maps to the same saved session. */
function sessionKey(roots) {
  return rootsOf(roots)
    .map(normalizePath)
    .sort()
    .join('\u0000')
}

function albumLabel(root, file) {
  const rel = path.relative(root, path.dirname(file))
  const base = path.basename(root)
  if (!rel) return base
  return `${base} / ${rel.split(path.sep).join(' / ')}`
}

/* ---------- json helpers ---------- */

const filePath = (name) => path.join(app.getPath('userData'), name)

async function readJson(name, fallback) {
  try {
    const raw = await fsp.readFile(filePath(name), 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJson(name, data) {
  const target = filePath(name)
  const tmp = `${target}.tmp`
  await fsp.mkdir(path.dirname(target), { recursive: true })
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fsp.rename(tmp, target)
}

const libraryPath = (roots) => {
  const hash = crypto.createHash('sha1').update(sessionKey(roots)).digest('hex')
  return path.join('libraries', `${hash}.json`)
}

function annotateRoots(items, roots) {
  const list = rootsOf(roots)
  for (const item of items) {
    if (item.root) continue
    const normalized = normalizePath(item.path)
    item.root = list.find((root) => normalized.startsWith(`${normalizePath(root)}${path.sep}`)) || null
  }
  return items
}

async function readLibrary(roots) {
  if (!rootsOf(roots).length) return null
  const cached = await readJson(libraryPath(roots), null)
  if (!cached || !Array.isArray(cached.items)) return null
  annotateRoots(cached.items, cached.roots || roots)
  return cached
}

/* ---------- kept (completed) items ---------- */

function keptList() {
  return [...kept]
}

function scheduleKeptWrite() {
  clearTimeout(keptTimer)
  keptTimer = setTimeout(() => {
    keptTimer = null
    writeJson('kept.json', Object.fromEntries(keptList().map((file) => [file, Date.now()]))).catch(() => {})
  }, 300)
}

async function flushKept() {
  if (keptTimer) {
    clearTimeout(keptTimer)
    keptTimer = null
  }
  await writeJson('kept.json', Object.fromEntries(keptList().map((file) => [file, Date.now()])))
}

function pruneKept(roots, items) {
  const list = rootsOf(roots)
  if (!list.length) return false
  const alive = new Set(items.map((item) => normalizePath(item.path)))
  let changed = false
  for (const file of [...kept]) {
    const normalized = normalizePath(file)
    if (!list.some((root) => normalized.startsWith(`${normalizePath(root)}${path.sep}`))) continue
    if (!alive.has(normalized)) {
      kept.delete(file)
      changed = true
    }
  }
  return changed
}

/* ---------- incremental metadata cache ---------- */

function cachedDate(item) {
  const entry = metaCache[item.path]
  if (!entry) return null
  if (entry.mtime !== item.mtime || entry.size !== item.size) return null
  return Number.isFinite(entry.takenAt) ? entry.takenAt : null
}

function storeDate(item, takenAt) {
  const before = metaCache[item.path]
  if (before && before.mtime === item.mtime && before.size === item.size && before.takenAt === takenAt) return
  metaCache[item.path] = { mtime: item.mtime, size: item.size, takenAt }
  metaDirty = true
}

function pruneMeta(roots, items) {
  const list = rootsOf(roots)
  if (!list.length) return false
  const alive = new Set(items.map((item) => item.path))
  let changed = false
  for (const file of Object.keys(metaCache)) {
    const normalized = normalizePath(file)
    if (!list.some((root) => normalized.startsWith(`${normalizePath(root)}${path.sep}`))) continue
    if (!alive.has(file)) {
      delete metaCache[file]
      changed = true
    }
  }
  return changed
}

/* ---------- media serving (range aware) ---------- */

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function resolveMediaPath(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.hostname !== 'local') return null
    let p = decodeURIComponent(url.pathname)
    if (p.startsWith('/')) p = p.slice(1)
    p = p.split('/').join(path.sep)
    return p
  } catch {
    return null
  }
}

async function serveMedia(request) {
  const p = resolveMediaPath(request.url)
  if (!p) return new Response('bad request', { status: 400 })
  if (!isAllowedMediaFile(p)) return new Response('forbidden', { status: 403 })
  const ext = path.extname(p).toLowerCase()
  const type = MIME[ext]
  if (!type) return new Response('forbidden', { status: 403 })

  let stat
  try {
    stat = await fsp.stat(p)
  } catch {
    return new Response('not found', { status: 404 })
  }

  const range = request.headers.get('range')
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0
      let end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1
      if (start >= stat.size) {
        return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
      }
      end = Math.min(end, stat.size - 1)
      const stream = Readable.toWeb(fs.createReadStream(p, { start, end }))
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      })
    }
  }

  return new Response(Readable.toWeb(fs.createReadStream(p)), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    }
  })
}

/* ---------- thumbnails ---------- */

const thumbDir = () => path.join(app.getPath('userData'), 'thumbs')

async function makeThumb(file, size) {
  const key = `${file}|${size}`
  if (thumbMemo.has(key)) return thumbMemo.get(key)

  let stat
  try {
    stat = await fsp.stat(file)
  } catch {
    return null
  }

  const hash = crypto.createHash('sha1').update(`${file}|${stat.mtimeMs}|${stat.size}|${size}`).digest('hex')
  const cached = path.join(thumbDir(), `${hash}.jpg`)

  try {
    await fsp.access(cached)
    const url = `media://local/${encodeURIComponent(cached)}`
    memoSet(thumbMemo, key, url, 4000)
    return url
  } catch {
    /* not cached yet */
  }

  let image
  try {
    image = await nativeImage.createThumbnailFromPath(file, { width: size, height: size })
  } catch {
    image = null
  }
  if (!image || image.isEmpty()) return null

  try {
    await fsp.mkdir(thumbDir(), { recursive: true })
    await fsp.writeFile(cached, image.toJPEG(84))
  } catch {
    return null
  }

  const url = `media://local/${encodeURIComponent(cached)}`
  memoSet(thumbMemo, key, url, 4000)
  return url
}

async function makeThumbs(files, size) {
  const out = {}
  const queue = [...files]
  const workers = new Array(Math.min(6, queue.length)).fill(0).map(async () => {
    while (queue.length) {
      const file = queue.shift()
      try {
        out[file] = await makeThumb(file, size)
      } catch {
        out[file] = null
      }
    }
  })
  await Promise.all(workers)
  return out
}

async function thumbStats() {
  let count = 0
  let bytes = 0
  try {
    const entries = await fsp.readdir(thumbDir(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      try {
        const stat = await fsp.stat(path.join(thumbDir(), entry.name))
        count += 1
        bytes += stat.size
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* no cache */
  }
  return { count, bytes }
}

/* Eski/bÃ¼yÃ¼k Ã¶nbelleÄŸi sessizce tahliye et: 30 gÃ¼nden eski veya toplam 1 GB Ã¼stÃ¼. */
async function pruneThumbs() {
  const dir = thumbDir()
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  const files = []
  let total = 0
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = path.join(dir, entry.name)
    try {
      const stat = await fsp.stat(full)
      total += stat.size
      if (stat.mtimeMs < cutoff) {
        await fsp.unlink(full).catch(() => {})
        total -= stat.size
        continue
      }
      files.push({ full, size: stat.size, mtime: stat.mtimeMs })
    } catch {
      /* ignore */
    }
  }
  const limit = 1024 * 1024 * 1024
  if (total > limit) {
    files.sort((a, b) => a.mtime - b.mtime)
    for (const file of files) {
      if (total <= limit) break
      try {
        await fsp.unlink(file.full)
        total -= file.size
      } catch {
        /* ignore */
      }
    }
  }
  thumbMemo.clear()
}

/* ---------- review session storage ---------- */

/* "Tut" ile iÅŸaretlenen Ã¶ÄŸeler hiÃ§bir oturumda tekrar gÃ¶rÃ¼nmez:
   kaydederken ve okurken kalÄ±cÄ± kept listesine gÃ¶re sÃ¼zÃ¼lÃ¼r. */
function stripKept(review) {
  if (!review?.items?.length) return null
  const limit = Math.min(Math.max(0, review.i || 0), review.items.length)
  const items = []
  let i = 0
  for (let index = 0; index < review.items.length; index += 1) {
    const item = review.items[index]
    if (kept.has(item.path)) continue
    if (index < limit) i += 1
    items.push(item)
  }
  if (!items.length) return null
  const paths = new Set(items.map((item) => item.path))
  const marks = {}
  for (const [file, verdict] of Object.entries(review.marks || {})) {
    if (paths.has(file)) marks[file] = verdict
  }
  return { ...review, items, i: Math.min(i, items.length), marks }
}

/* Bir klasÃ¶r grubunun oturum ilk aÃ§Ä±ldÄ±ÄŸÄ± andaki Ã¶ÄŸe sayÄ±sÄ±.
   Yeni oturumlarda initialTotals haritasÄ±yla taÅŸÄ±nÄ±r; eski kayÄ±tlarda
   eldeki kalan sayÄ±ya dÃ¼ÅŸer (geriye dÃ¶nÃ¼k uyum). */
function initialTotalFor(review, folder, fallback, globalFallback = 0) {
  const totals = review?.initialTotals
  const key = normalizePath(folder)
  const stored = totals && typeof totals === 'object' ? Number(totals[key]) : NaN
  const value = Number.isFinite(stored) && stored > 0 ? stored : 0
  const global = Number.isFinite(globalFallback) && globalFallback > 0 ? globalFallback : 0
  return Math.max(fallback, value, global)
}

function findRootForItem(item, roots) {
  const list = rootsOf(roots)
  if (item?.root) {
    const match = list.find((root) => normalizePath(root) === normalizePath(item.root))
    if (match) return match
  }
  if (!item?.path) return null
  const normalized = normalizePath(item.path)
  return list.find((root) => normalized.startsWith(`${normalizePath(root)}${path.sep}`)) || null
}

/* Bir Ã¶ÄŸenin ait olduÄŸu klasÃ¶r: albÃ¼m modunda gerÃ§ek alt klasÃ¶r,
   diÄŸer modlarda yapÄ±landÄ±rÄ±lmÄ±ÅŸ kÃ¶k klasÃ¶r. BÃ¶ylece her klasÃ¶r ve
   alt klasÃ¶r kendi oturumunu alÄ±r. */
function folderOfItem(item, mode) {
  if (mode === 'album') return path.dirname(item.path)
  return item.root || path.dirname(item.path)
}

const TYPE_ORDER = { image: 0, video: 1, gif: 2 }

/* TÃ¼r oturumlarÄ±nda klasÃ¶r yerine medya tÃ¼rÃ¼ kapsamÄ± kullanÄ±lÄ±r. */
function typeKeyOf(item) {
  return item?.ext === '.gif' ? 'gif' : item?.kind || 'image'
}

function typeScopeOf(items) {
  const keys = new Set()
  for (const item of items || []) keys.add(typeKeyOf(item))
  return [...keys].sort((a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9))
}

/* Oturum anahtarÄ±: mod + klasÃ¶r kÃ¼mesi (+ isteÄŸe baÄŸlÄ± oturum kimliÄŸi).
   Mod Ã¶neki sayesinde albÃ¼m, ay, tÃ¼r ve galeri oturumlarÄ± birbirini ezmez.
   `sessionId` verilirse aynÄ± mod + klasÃ¶rde birden fazla oturum yan yana yaÅŸar. */
function reviewKey(mode, folders, sessionId) {
  const list = rootsOf(folders)
  if (!list.length) return ''
  const base = `${mode || 'review'}\u0001${sessionKey(list)}`
  return sessionId ? `${base}\u0001${sessionId}` : base
}

/* BirleÅŸik bir oturumu klasÃ¶r (albÃ¼m) baÅŸÄ±na ayrÄ± gruplara bÃ¶ler.
   TÃ¼r oturumlarÄ±nda bÃ¶lÃ¼nmez: seÃ§ilen tÃ¼m tÃ¼rler tek oturumda toplanÄ±r. */
function splitReviewByFolder(review) {
  const mode = review?.mode || 'album'
  const groups = new Map()
  const total = review?.items?.length || 0
  const limit = Math.min(Math.max(0, review?.i || 0), total)
  if (mode === 'type') {
    const items = []
    const marks = {}
    let reviewed = 0
    for (let index = 0; index < total; index += 1) {
      const item = review.items[index]
      if (!item?.path) continue
      items.push(item)
      if (index < limit) reviewed += 1
      if (review.marks?.[item.path]) marks[item.path] = review.marks[item.path]
    }
    if (!items.length) return groups
    const folder = `type:${typeScopeOf(items).join('+')}`
    groups.set(folder, {
      folder,
      items,
      marks,
      i: Math.min(reviewed, items.length),
      initialTotal: initialTotalFor(review, folder, items.length, Number(review.initialTotal) || 0)
    })
    return groups
  }
  for (let index = 0; index < total; index += 1) {
    const item = review.items[index]
    const folder = folderOfItem(item, mode)
    if (!folder) continue
    const key = normalizePath(folder)
    if (!groups.has(key)) groups.set(key, { folder, items: [], marks: {}, i: 0 })
    const group = groups.get(key)
    group.items.push(item)
    if (review.marks?.[item.path]) group.marks[item.path] = review.marks[item.path]
    if (index < limit) group.i += 1
  }
  for (const group of groups.values()) {
    group.initialTotal = initialTotalFor(review, group.folder, group.items.length)
  }
  return groups
}

/* Eski sÃ¼rÃ¼mde kÃ¶k klasÃ¶r baÅŸÄ±na bÃ¶lÃ¼nmÃ¼ÅŸ tÃ¼r oturumlarÄ±nÄ± tek oturumda birleÅŸtirir.
   Ä°ncelenmiÅŸ Ã¶ÄŸeler baÅŸa alÄ±nÄ±r ki ilerleme (i) doÄŸru kalsÄ±n. */
function mergeTypeParts(parts) {
  const folder = parts[0]?.group?.folder || 'type:'
  const items = []
  const seen = new Set()
  const marks = {}
  const roots = []
  let reviewed = 0
  let initialTotal = 0
  let startedAt = 0
  let sort = 'session'
  const push = (item, isReviewed) => {
    if (!item?.path || seen.has(item.path)) return
    seen.add(item.path)
    items.push(item)
    if (isReviewed) reviewed += 1
  }
  for (const part of parts) {
    const limit = Math.min(Math.max(0, part.group.i || 0), part.group.items.length)
    for (const item of part.group.items.slice(0, limit)) push(item, true)
  }
  for (const part of parts) {
    const limit = Math.min(Math.max(0, part.group.i || 0), part.group.items.length)
    for (const item of part.group.items.slice(limit)) push(item, false)
  }
  for (const part of parts) {
    Object.assign(marks, part.group.marks || {})
    initialTotal += Math.max(Number(part.group?.initialTotal) || 0, part.group?.items?.length || 0)
    const start = part.clean?.startedAt || part.entry?.updatedAt || 0
    if (start && (!startedAt || start < startedAt)) startedAt = start
    if (part.clean?.sort) sort = part.clean.sort
    for (const root of rootsOf(part.entry?.roots)) {
      if (!roots.some((known) => normalizePath(known) === normalizePath(root))) roots.push(root)
    }
  }
  if (!startedAt) startedAt = Date.now()
  initialTotal = Math.max(initialTotal, items.length)
  return {
    folder,
    roots,
    review: {
      items,
      i: reviewed,
      marks,
      startedAt,
      mode: 'type',
      roots,
      scope: [folder],
      sort,
      initialTotal,
      initialTotals: { [normalizePath(folder)]: initialTotal },
      sessionId: parts[0]?.clean?.sessionId || null
    }
  }
}

function makeReview(group, mode, topRoot) {
  const initialTotal = Math.max(Number(group.initialTotal) || 0, group.items.length)
  return {
    items: group.items,
    i: Math.min(group.i, group.items.length),
    marks: group.marks,
    startedAt: group.startedAt,
    mode,
    roots: rootsOf(topRoot),
    scope: [group.folder],
    sort: group.sort || 'session',
    initialTotal,
    initialTotals: { [normalizePath(group.folder)]: initialTotal }
  }
}

function reviewSummaries() {
  const configured = new Set(rootsOf(settings.rootFolders).map(normalizePath))
  return Object.entries(reviews)
    .map(([key, entry]) => {
      const roots = rootsOf(entry?.roots)
      // KlasÃ¶r listeden Ã§Ä±karÄ±ldÄ±ysa oturum da yoktur.
      if (!roots.length) return null
      if (!roots.every((root) => configured.has(normalizePath(root)))) return null
      const review = stripKept(entry?.review)
      const items = review?.items || []
      if (!items.length) return null
      // İlerleme konuma göre değil kararlara göre: son fotoğrafa atlamak
      // "kalan" sayısını değiştirmez (madde 29/36).
      const marks = review?.marks || {}
      const remaining = items.filter((item) => !marks[item.path]).length
      if (remaining <= 0) return null
      const total = Math.max(items.length, Number(review.initialTotal) || 0)
      const scope = rootsOf(entry?.scope?.length ? entry.scope : roots)
      return {
        key,
        roots,
        scope,
        total,
        remaining,
        mode: review.mode || 'album',
        // AynÄ± mod + klasÃ¶rde birden fazla oturum olabileceÄŸi iÃ§in kimlik taÅŸÄ±nÄ±r.
        sessionId: review.sessionId || null,
        updatedAt: entry.updatedAt || 0
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/* KlasÃ¶r listesinden Ã§Ä±kan oturumlarÄ± siler; eski Ã§ok kÃ¶klÃ¼ / kÃ¶k bazlÄ±
   oturumlarÄ± klasÃ¶r (albÃ¼m) baÅŸÄ±na bÃ¶ler. */
function pruneReviews(nextRoots) {
  const allowedRoots = rootsOf(nextRoots)
  const allowed = new Set(allowedRoots.map(normalizePath))
  const next = {}
  const typeBuckets = new Map()
  let changed = false
  for (const [key, entry] of Object.entries(reviews)) {
    const roots = rootsOf(entry?.roots)
    if (!roots.length) {
      changed = true
      continue
    }
    if (!roots.some((root) => allowed.has(normalizePath(root)))) {
      changed = true
      continue
    }
    const clean = stripKept(entry.review)
    if (!clean?.items?.length) {
      changed = true
      continue
    }
    const mode = clean.mode || 'album'
    const groups = splitReviewByFolder(clean)
    if (mode === 'type') {
      const group = [...groups.values()][0]
      const topRoot = group ? findRootForItem(group.items[0], allowedRoots) : null
      const nextKey = group && topRoot ? reviewKey(mode, [group.folder], clean.sessionId) : ''
      if (!nextKey) {
        changed = true
        continue
      }
      if (!typeBuckets.has(nextKey)) typeBuckets.set(nextKey, [])
      typeBuckets.get(nextKey).push({ key, entry, clean, group, topRoot })
      continue
    }
    for (const group of groups.values()) {
      const topRoot = findRootForItem(group.items[0], allowedRoots)
      if (!topRoot) {
        changed = true
        continue
      }
      const nextKey = reviewKey(mode, [group.folder], clean.sessionId)
      if (!nextKey) {
        changed = true
        continue
      }
      if (next[nextKey]) continue
      if (key === nextKey && groups.size === 1) {
        next[nextKey] = entry
      } else {
        next[nextKey] = {
          roots: [topRoot],
          scope: [group.folder],
          review: {
            ...makeReview({ ...group, startedAt: clean.startedAt, sort: clean.sort }, mode, [topRoot]),
            sessionId: clean.sessionId || null
          },
          updatedAt: entry.updatedAt || Date.now()
        }
        changed = true
      }
    }
  }
  // TÃ¼r oturumlarÄ±: tÃ¼m kÃ¶k klasÃ¶rler tek oturumda birleÅŸir.
  for (const [nextKey, parts] of typeBuckets) {
    if (parts.length === 1 && parts[0].key === nextKey) {
      next[nextKey] = parts[0].entry
      continue
    }
    const merged = mergeTypeParts(parts)
    next[nextKey] = {
      roots: merged.roots,
      scope: [merged.folder],
      review: merged.review,
      updatedAt: Math.max(...parts.map((part) => part.entry.updatedAt || 0)) || Date.now()
    }
    changed = true
  }
  if (changed) reviews = next
  return changed
}

async function saveReviewState(roots, review, options = {}) {
  const mode = review?.mode || options.mode || 'album'
  const sessionId = review?.sessionId || options.sessionId || null
  const requested = rootsOf(
    options.scope?.length ? options.scope : review?.scope?.length ? review.scope : roots
  )
  const clean = stripKept(review)
  if (!clean?.items?.length) {
    if (sessionId) {
      // Sadece bu oturumun kayÄ±tlarÄ±nÄ± kaldÄ±r; aynÄ± moddaki diÄŸer oturumlar kalsÄ±n.
      for (const key of Object.keys(reviews)) {
        if ((reviews[key]?.review?.sessionId || null) === sessionId) delete reviews[key]
      }
    } else {
      const requestedSet = new Set(requested.map(normalizePath))
      for (const folder of requested) {
        const key = reviewKey(mode, [folder])
        if (key) delete reviews[key]
      }
      if (mode === 'type') {
        for (const [key, entry] of Object.entries(reviews)) {
          if ((entry?.review?.mode || 'album') !== 'type') continue
          const stale = stripKept(entry.review)
          const group = stale ? [...splitReviewByFolder(stale).values()][0] : null
          if (!group || requestedSet.has(normalizePath(group.folder))) delete reviews[key]
        }
      }
    }
    await writeJson('reviews.json', reviews)
    return reviewSummaries()
  }
  const groups = splitReviewByFolder(clean)
  const affected = new Set()
  for (const group of groups.values()) {
    const rootList = rootsOf(clean.roots?.length ? clean.roots : roots)
    const topRoot =
      mode === 'type'
        ? rootList[0] || findRootForItem(group.items[0], rootsOf(settings.rootFolders)) || group.folder
        : findRootForItem(group.items[0], rootsOf(settings.rootFolders)) || rootList[0] || group.folder
    const entryRoots = mode === 'type' && rootList.length ? rootList : [topRoot]
    const key = reviewKey(mode, [group.folder], sessionId)
    if (!key) continue
    affected.add(key)
    reviews[key] = {
      roots: entryRoots,
      scope: [group.folder],
      review: { ...makeReview({ ...group, startedAt: clean.startedAt, sort: clean.sort }, mode, entryRoots), sessionId },
      updatedAt: Date.now()
    }
  }
  if (sessionId) {
    // Bu oturumun artÄ±k Ã¼retilmeyen grup anahtarlarÄ±nÄ± temizle.
    for (const key of Object.keys(reviews)) {
      if (affected.has(key)) continue
      if ((reviews[key]?.review?.sessionId || null) === sessionId) delete reviews[key]
    }
  } else {
    // Kapsamda olup artÄ±k Ã¶ÄŸesi kalmamÄ±ÅŸ klasÃ¶r oturumlarÄ±nÄ± temizle.
    const requestedSet = new Set(requested.map(normalizePath))
    for (const key of Object.keys(reviews)) {
      if (affected.has(key)) continue
      const entry = reviews[key]
      if ((entry?.review?.mode || 'album') !== mode) continue
      if (mode === 'type') {
        const stale = stripKept(entry.review)
        const group = stale ? [...splitReviewByFolder(stale).values()][0] : null
        if (!group || requestedSet.has(normalizePath(group.folder))) delete reviews[key]
        continue
      }
      const entryScope = rootsOf(entry?.scope)
      if (entryScope.length !== 1) continue
      if (requestedSet.has(normalizePath(entryScope[0]))) delete reviews[key]
    }
  }
  await writeJson('reviews.json', reviews)
  return reviewSummaries()
}

/* ---------- window ---------- */

function createWindow() {
  const bounds = settings.window || DEFAULTS.window

  mainWindow = new BrowserWindow({
    width: bounds.width || 1320,
    height: bounds.height || 860,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#081c1e',
    title: 'CullDeck',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  if (bounds.maximized) mainWindow.maximize()

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  const notify = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:maximized', mainWindow.isMaximized())
    }
  }
  mainWindow.on('maximize', notify)
  mainWindow.on('unmaximize', notify)

  mainWindow.on('close', async () => {
    if (!mainWindow) return
    const maximized = mainWindow.isMaximized()
    const { width, height, x, y } = mainWindow.getNormalBounds()
    settings.window = { width, height, x, y, maximized }
    await writeJson('settings.json', settings).catch(() => {})
    await flushKept().catch(() => {})
    if (metaDirty) await writeJson('meta.json', metaCache).catch(() => {})
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // The window may only ever show the app's own document.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedFrameUrl(url)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedFrameUrl(url)) event.preventDefault()
  })
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  if (isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') {
        mainWindow.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }
}

/* ---------- ipc ---------- */

function registerIpc() {
  ipcHandle('app:bootstrap', async () => {
    const roots = rootsOf(settings.rootFolders)
    return {
      settings,
      stats,
      // KlasÃ¶r baÅŸÄ±na oturumlar evdeki "devam et" kartÄ±ndan aÃ§Ä±lÄ±r.
      review: null,
      reviewSessions: reviewSummaries(),
      version: app.getVersion(),
      userData: app.getPath('userData'),
      library: await readLibrary(roots),
      rootStatus: await checkRoots(roots),
      kept: keptList()
    }
  })

  ipcHandle('app:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'FotoÄŸraf klasÃ¶rÃ¼ seÃ§',
      properties: ['openDirectory'],
      defaultPath: (settings.rootFolders && settings.rootFolders[0]) || app.getPath('pictures')
    })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcHandle('app:path-info', async (_event, target) => {
    try {
      const stat = await fsp.stat(target)
      return { path: target, isDirectory: stat.isDirectory() }
    } catch {
      return null
    }
  })

  ipcHandle('app:cancel-scan', () => {
    if (scanState) scanState.cancelled = true
    return true
  })

  ipcHandle('app:scan', async (event, roots) => {
    const list = rootsOf(roots)
    if (!list.length) throw new Error('KlasÃ¶r seÃ§ilmedi')
    if (scanState) throw new Error('SCAN_BUSY')

    const state = { cancelled: false }
    scanState = state
    const sender = event.sender
    const started = Date.now()
    let last = 0
    const progress = (payload) => {
      const now = Date.now()
      if (now - last > 120) {
        last = now
        if (!sender.isDestroyed()) sender.send('scan:progress', payload)
      }
    }

    try {
      const items = []
      const seen = new Set()
      const rootStatus = []
      for (const root of list) {
        // Tarama 0 Ã¶ÄŸe dÃ¶nse bile nedenini ayÄ±rt edebilmek iÃ§in Ã¶nce canlÄ±lÄ±k denetimi.
        const status = await checkRootPath(root)
        let scanned = []
        if (status.ok) {
          const result = await scanFolder(root, {
            showVideos: settings.showVideos,
            onProgress: progress,
            shouldStop: () => state.cancelled,
            getCachedDate: cachedDate,
            setCachedDate: storeDate
          })
          scanned = result.items
        }
        for (const item of scanned) {
          if (seen.has(item.path)) continue
          seen.add(item.path)
          item.root = root
          if (list.length > 1) item.album = albumLabel(root, item.path)
          items.push(item)
        }
        rootStatus.push({ ...status, count: scanned.length })
      }
      if (state.cancelled) {
        const error = new Error('SCAN_CANCELLED')
        error.code = 'SCAN_CANCELLED'
        throw error
      }

      items.sort((a, b) => b.takenAt - a.takenAt)
      const scannedAt = Date.now()
      // Budama yalnÄ±zca canlÄ± kÃ¶klerde: eriÅŸilemeyen/eksik bir kÃ¶kenin
      // kayÄ±tlÄ± kept/meta verileri bu taramayla silinmez (dÃ¼zeltilebilir).
      const liveRoots = rootStatus.filter((entry) => entry.ok).map((entry) => entry.path)
      const keptChanged = pruneKept(liveRoots, items)
      const metaChanged = pruneMeta(liveRoots, items)
      if (keptChanged) await flushKept().catch(() => {})
      if (metaDirty || metaChanged) {
        await writeJson('meta.json', metaCache).catch(() => {})
        metaDirty = false
      }
      await writeJson(libraryPath(list), { roots: list, items, scannedAt }).catch(() => {})

      return { roots: list, items, scannedAt, elapsed: scannedAt - started, rootStatus, kept: keptList() }
    } finally {
      if (scanState === state) scanState = null
    }
  })

  ipcHandle('app:save-settings', async (_event, patch) => {
    const nextRoots = 'rootFolders' in patch ? patch.rootFolders : settings.rootFolders
    settings = { ...settings, ...patch, window: settings.window }
    if ('rootFolders' in patch && pruneReviews(nextRoots)) {
      await writeJson('reviews.json', reviews).catch(() => {})
    }
    await writeJson('settings.json', settings)
    return settings
  })

  ipcHandle('app:add-session', async (_event, session) => {
    stats = { sessions: [session, ...(stats.sessions || [])].slice(0, 500) }
    await writeJson('stats.json', stats)
    return stats
  })

  ipcHandle('app:reset-stats', async () => {
    stats = { sessions: [] }
    await writeJson('stats.json', stats)
    return stats
  })

  ipcHandle('app:save-review', async (_event, payload) => {
    const review = payload?.review === undefined ? payload : payload.review
    const roots = rootsOf(review?.roots?.length ? review.roots : payload?.roots ?? settings.rootFolders)
    return saveReviewState(roots, review)
  })

  ipcHandle('app:clear-review', async (_event, payload) => {
    const roots = rootsOf(payload?.roots ?? settings.rootFolders)
    return saveReviewState(roots, null, {
      scope: payload?.scope,
      mode: payload?.mode,
      sessionId: payload?.sessionId || null
    })
  })

  ipcHandle('app:get-review', async (_event, payload) => {
    // Yeni oturumlar anahtarla aÃ§Ä±lÄ±r; dizi gelirse eski anahtar biÃ§imi denenir.
    const key = typeof payload === 'string' ? payload : sessionKey(rootsOf(payload))
    const entry = reviews[key]
    if (!entry) return null
    const review = stripKept(entry.review)
    if (!review) return null
    return {
      ...review,
      roots: rootsOf(review.roots?.length ? review.roots : entry.roots),
      scope: rootsOf(review.scope?.length ? review.scope : entry.scope)
    }
  })

  ipcHandle('app:review-sessions', () => reviewSummaries())

  ipcHandle('app:set-kept', async (_event, paths, keep) => {
    const list = rootsOf(paths)
    if (keep) list.forEach((file) => kept.add(file))
    else list.forEach((file) => kept.delete(file))
    scheduleKeptWrite()
    return keptList()
  })

  /* AynÄ± moddan Ã§oklu oturum: "Ã¶ncekini sonlandÄ±r ve baÅŸlat" seÃ§ilince
     ilgili kayÄ±tlÄ± oturumlar (anahtar listesiyle) diskten silinir. */
  ipcHandle('app:drop-sessions', async (_event, payload) => {
    const requested = Array.isArray(payload) ? payload : rootsOf(payload?.keys)
    const wanted = new Set(requested.filter(Boolean))
    if (!wanted.size) return reviewSummaries()
    let changed = false
    for (const key of Object.keys(reviews)) {
      if (!wanted.has(key)) continue
      delete reviews[key]
      changed = true
    }
    if (changed) await writeJson('reviews.json', reviews).catch(() => {})
    return reviewSummaries()
  })

  /* Bozuk kÃ¶k yolunu dÃ¼zeltir: kept.json, meta.json ve kayÄ±tlÄ± oturumlardaki
     yollar eski kÃ¶kten yeni kÃ¶ke taÅŸÄ±nÄ±r; settings.rootFolders da gÃ¼ncellenir.
     KÃ¶k yalnÄ±zca yeniden adlandÄ±rÄ±lmÄ±ÅŸtÄ±r, iÃ§erik aynÄ±dÄ±r; bu yÃ¼zden oturum
     budamasÄ± (pruneReviews) yapÄ±lmaz. */
  ipcHandle('app:replace-root', async (_event, payload) => {
    const from = String(payload?.from || '')
    const to = String(payload?.to || '')
    if (!from || !to) throw new Error('KlasÃ¶r yolu dÃ¼zeltilemedi')
    if (normalizePath(from) === normalizePath(to)) return { settings, kept: keptList(), sessions: reviewSummaries(), moved: { kept: 0, meta: 0, sessions: 0, files: 0 } }
    const status = await checkRootPath(to)
    if (!status.ok) throw new Error('SeÃ§ilen klasÃ¶r eriÅŸilemedi')

    // 1) Tutulanlar (kept.json)
    let movedKept = 0
    for (const file of [...kept]) {
      if (!isUnderPath(file, from)) continue
      kept.delete(file)
      kept.add(remapPath(file, from, to))
      movedKept += 1
    }
    if (movedKept) await flushKept().catch(() => {})

    // 2) EXIF/meta Ã¶nbelleÄŸi (meta.json)
    let movedMeta = 0
    for (const file of Object.keys(metaCache)) {
      if (!isUnderPath(file, from)) continue
      metaCache[remapPath(file, from, to)] = metaCache[file]
      delete metaCache[file]
      movedMeta += 1
    }
    if (movedMeta || metaDirty) {
      await writeJson('meta.json', metaCache).catch(() => {})
      metaDirty = false
    }

    // 3) KayÄ±tlÄ± oturumlar (reviews.json): yollar, iÅŸaretler ve anahtarlar taÅŸÄ±nÄ±r.
    const nextReviews = {}
    let movedSessions = 0
    let movedFiles = 0
    for (const [key, entry] of Object.entries(reviews)) {
      const review = entry?.review
      if (!review?.items?.length) {
        // Ä°Ã§eriÄŸi bozuk oturumu taÅŸÄ±ma zaten yapÄ±labilecek kadar net deÄŸil; bÄ±rak.
        continue
      }
      const entryRoots = rootsOf(entry.roots).map((root) => remapPath(root, from, to))
      const entryScope = rootsOf(entry.scope).map((folder) => remapPath(folder, from, to))
      const prevRoots = rootsOf(review.roots)
      const prevScope = rootsOf(review.scope)
      const items = []
      for (const item of review.items) {
        const nextPath = remapPath(item?.path, from, to)
        if (nextPath !== item?.path) movedFiles += 1
        const mapped = { ...item, id: nextPath, path: nextPath }
        if (item.root) mapped.root = remapPath(item.root, from, to)
        // AlbÃ¼m etiketi eski kÃ¶k adÄ±nÄ± iÃ§eriyorsa yeni kÃ¶ke gÃ¶re tazele.
        if (item.album && entryRoots.length) {
          const owner = entryRoots.find((root) => isUnderPath(nextPath, root))
          if (owner) mapped.album = albumLabel(owner, nextPath)
        }
        items.push(mapped)
      }
      const marks = {}
      for (const [file, verdict] of Object.entries(review.marks || {})) {
        marks[remapPath(file, from, to)] = verdict
      }
      const nextReview = {
        ...review,
        roots: prevRoots.length ? prevRoots.map((root) => remapPath(root, from, to)) : prevRoots,
        scope: prevScope.length ? prevScope.map((folder) => remapPath(folder, from, to)) : prevScope,
        items,
        marks
      }
      const mode = review.mode || 'album'
      const scope = nextReview.scope?.length ? nextReview.scope : entryScope
      const nextKey = reviewKey(mode, scope.length ? scope : entryRoots, review.sessionId)
      if (!nextKey) continue
      nextReviews[nextKey] = {
        ...entry,
        roots: entryRoots.length ? entryRoots : entry.roots,
        scope: entryScope.length ? entryScope : entry.scope,
        review: nextReview,
        updatedAt: Date.now()
      }
      movedSessions += 1
    }
    reviews = nextReviews
    await writeJson('reviews.json', reviews).catch(() => {})

    // 4) Ayarlardaki kaynak klasÃ¶rleri gÃ¼ncelle.
    settings = { ...settings, rootFolders: rootsOf(settings.rootFolders).map((root) => remapPath(root, from, to)) }
    await writeJson('settings.json', settings).catch(() => {})

    return { settings, kept: keptList(), sessions: reviewSummaries(), moved: { kept: movedKept, meta: movedMeta, sessions: movedSessions, files: movedFiles } }
  })

  ipcHandle('media:thumb', (_event, file, size) => (isAllowedMediaFile(file) ? makeThumb(file, size || 512) : null))
  ipcHandle('media:thumbs', (_event, files, size) => {
    const list = (Array.isArray(files) ? files : []).filter((file) => isAllowedMediaFile(file))
    return makeThumbs(list, size || 512)
  })

  ipcHandle('media:meta', async (_event, file) => {
    if (!file || !isUnderAnyRoot(file)) return null
    let stat
    try {
      stat = await fsp.stat(file)
    } catch {
      return null
    }
    const key = `${file}|${stat.mtimeMs}|${stat.size}`
    if (exifMemo.has(key)) return exifMemo.get(key)

    const ext = path.extname(file).toLowerCase()
    if (!MIME[ext]?.startsWith('image/')) {
      const videoMeta = { kind: 'video', width: null, height: null }
      memoSet(exifMemo, key, videoMeta, 8000)
      return videoMeta
    }

    let result = { kind: 'image', width: null, height: null, make: null, model: null, lens: null, iso: null, fnumber: null, exposure: null, focal: null, takenAt: null }
    try {
      const data = await exifr.parse(file, {
        pick: [
          'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight',
          'Make', 'Model', 'LensModel', 'ISO', 'FNumber', 'ExposureTime',
          'FocalLength', 'DateTimeOriginal', 'CreateDate'
        ]
      })
      if (data) {
        result = {
          ...result,
          width: data.ExifImageWidth || data.ImageWidth || null,
          height: data.ExifImageHeight || data.ImageHeight || null,
          make: data.Make || null,
          model: data.Model || null,
          lens: data.LensModel || null,
          iso: data.ISO || null,
          fnumber: data.FNumber || null,
          exposure: data.ExposureTime || null,
          focal: data.FocalLength || null,
          takenAt: data.DateTimeOriginal instanceof Date ? data.DateTimeOriginal.getTime() : null
        }
      }
    } catch {
      /* metadata optional */
    }
    memoSet(exifMemo, key, result, 8000)
    return result
  })

  ipcHandle('app:thumb-stats', () => thumbStats())
  ipcHandle('app:clear-thumbs', async () => {
    try {
      const entries = await fsp.readdir(thumbDir(), { withFileTypes: true })
      await Promise.all(entries.filter((entry) => entry.isFile()).map((entry) => fsp.unlink(path.join(thumbDir(), entry.name)).catch(() => {})))
    } catch {
      /* ignore */
    }
    thumbMemo.clear()
    return thumbStats()
  })

  // Silme iÅŸlemi: kÄ±sa sÃ¼reli kilit / salt okunur / zaten silinmiÅŸ dosyalara dayanÄ±klÄ±.
  // Geri dÃ¶nÃ¼ÅŸÃ¼m kutusuna taÅŸÄ±namayan bozuk dosyalar kalÄ±cÄ± silinmeden Ã¶nce
  // uygulama verisindeki karantina klasÃ¶rÃ¼ne alÄ±nÄ±r.
  const fileExists = async (file) => {
    try {
      await fsp.access(file)
      return true
    } catch {
      return false
    }
  }

  const quarantineFile = async (file) => {
    if (!(await fileExists(file))) return true
    try {
      const dir = path.join(app.getPath('userData'), 'quarantine')
      await fsp.mkdir(dir, { recursive: true })
      const target = path.join(dir, `${Date.now()}-${path.basename(file)}`)
      try {
        await fsp.rename(file, target)
      } catch {
        await fsp.copyFile(file, target)
        await fsp.unlink(file)
      }
      return true
    } catch {
      return false
    }
  }

  const removeFiles = async (files, mode) => {
    const failed = []
    const reasons = {}
    const queue = (files || []).filter((file) => typeof file === 'string' && file)
    let cursor = 0

    const removeOne = async (file) => {
      // Only media files inside the folders the user actually scanned may be
      // removed; never an arbitrary path supplied by the renderer.
      if (!isUnderAnyRoot(file) || !isMediaFile(file)) {
        failed.push(file)
        reasons[file] = 'not-allowed'
        return
      }
      if (!(await fileExists(file))) return // zaten yok: baÅŸarÄ±lÄ±
      let removed = false
      let lastError = null
      for (let attempt = 0; attempt < 3 && !removed; attempt += 1) {
        try {
          if (mode === 'trash') await shell.trashItem(file)
          else await fsp.unlink(file)
          removed = true
        } catch (error) {
          if (error?.code === 'ENOENT') {
            removed = true
            break
          }
          lastError = error
          // Salt okunur iÅŸareti silmeyi engelleyebilir.
          try {
            await fsp.chmod(file, 0o666)
          } catch {
            /* ignore */
          }
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
        }
      }
      if (!removed) {
        // Ã‡Ã¶p kutusu/disk hatasÄ±nda dosyayÄ± kaybetmeden klasÃ¶rden Ã§Ä±kar.
        removed = await quarantineFile(file)
        if (removed) console.warn('[media] quarantined instead of deleted:', file)
      }
      if (!removed) {
        // Son Ã§are: kalÄ±cÄ± silme (dosya zaten kilitliyse bu da baÅŸarÄ±sÄ±z olur).
        try {
          await fsp.unlink(file)
          removed = true
        } catch (error) {
          if (error?.code === 'ENOENT') removed = true
          else lastError = error
        }
      }
      if (!removed) {
        failed.push(file)
        reasons[file] = lastError?.message || 'unknown'
        console.warn('[media] could not delete:', file, reasons[file])
      }
    }

    // Trashing a file costs ~40 ms. Removing many items sequentially delayed
    // the session summary, so a small number run concurrently.
    const worker = async () => {
      while (cursor < queue.length) {
        const file = queue[cursor]
        cursor += 1
        await removeOne(file)
      }
    }
    const workers = Math.min(4, queue.length)
    await Promise.all(Array.from({ length: workers }, () => worker()))
    return { failed, reasons }
  }

  ipcHandle('media:trash', async (_event, files) => removeFiles(files, 'trash'))

  ipcHandle('media:delete', async (_event, files) => removeFiles(files, 'delete'))

  ipcHandle('shell:reveal', async (_event, file) => {
    if (!isAllowedMediaFile(file)) return false
    shell.showItemInFolder(file)
    return true
  })

  ipcHandle('shell:open', async (_event, file) => {
    if (typeof file !== 'string' || !file) return 'INVALID_PATH'
    const target = path.resolve(file)
    // Media inside scanned folders, or the app's own data folder (Settings > Open folder).
    const isDataFolder = normalizePath(target) === normalizePath(app.getPath('userData'))
    const allowed = (isUnderAnyRoot(target) && isMediaFile(target)) || isDataFolder
    if (!allowed) return 'NOT_ALLOWED'
    const error = await shell.openPath(target)
    return error || null
  })

  ipcHandle('win:minimize', () => mainWindow?.minimize())
  ipcHandle('win:toggle-maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcHandle('win:close', () => mainWindow?.close())
  ipcHandle('win:is-maximized', () => Boolean(mainWindow?.isMaximized()))
}

/* ---------- lifecycle ---------- */

app.whenReady().then(async () => {
  app.setAppUserModelId('com.reco.culldeck')
  Menu.setApplicationMenu(null)

  const stored = await readJson('settings.json', DEFAULTS)
  settings = { ...DEFAULTS, ...stored }
  if (!Array.isArray(settings.rootFolders)) {
    settings.rootFolders = settings.rootFolder ? [settings.rootFolder] : []
  }
  delete settings.rootFolder

  stats = await readJson('stats.json', { sessions: [] })

  const storedKept = await readJson('kept.json', {})
  kept = new Set(Array.isArray(storedKept) ? storedKept : Object.keys(storedKept || {}))
  metaCache = await readJson('meta.json', {})

  const storedReviews = await readJson('reviews.json', null)
  reviews = storedReviews && typeof storedReviews === 'object' ? storedReviews : {}
  const legacy = await readJson('review.json', null)
  if (legacy?.items?.length) {
    const key = sessionKey(settings.rootFolders)
    if (key && !reviews[key]) {
      reviews[key] = { roots: rootsOf(settings.rootFolders), review: legacy, updatedAt: Date.now() }
      await writeJson('reviews.json', reviews)
    }
    try {
      await fsp.rename(filePath('review.json'), filePath('review.legacy.json'))
    } catch {
      /* already migrated */
    }
  }
  // KlasÃ¶rÃ¼ kaldÄ±rÄ±lmÄ±ÅŸ oturumlarÄ± temizle; Ã§ok klasÃ¶rlÃ¼ eski oturumlarÄ± bÃ¶l.
  if (pruneReviews(settings.rootFolders)) {
    await writeJson('reviews.json', reviews).catch(() => {})
  }
  if (!metaCache || typeof metaCache !== 'object') metaCache = {}

  protocol.handle('media', serveMedia)

  // The app never needs camera, microphone, location, clipboard or
  // notification access: deny every permission request and check.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  registerIpc()
  createWindow()
  pruneThumbs().catch(() => {})

  if (process.env.SPONGE_SHOT_DIR) {
    const script = process.env.SPONGE_SHOT_SCRIPT || './dev-shots.cjs'
    require(script)(mainWindow, process.env.SPONGE_SHOT_DIR).catch((error) => {
      console.error('[shots] hata', error)
      app.quit()
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
