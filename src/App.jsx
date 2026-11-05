import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Icon from './components/Icon'
import { TitleBar, Sidebar, Toasts } from './components/ui'
import { I18nContext, translate } from './i18n'
import { formatBytes, monthKey } from './lib/format'
import { folderOf, folderScope, scopeLabel, sessionKey } from './lib/session'
import { playSound, preloadSounds, setSoundEnabled } from './lib/sound'
import Home from './screens/Home'
import Select from './screens/Select'
import Review from './screens/Review'
import Gallery from './screens/Gallery'
import Stats from './screens/Stats'
import Settings from './screens/Settings'

const DEFAULT_SETTINGS = {
  theme: 'dark',
  lang: 'tr',
  swipe: 'left-delete',
  deleteMode: 'trash',
  gridSize: 'medium',
  rootFolders: [],
  showVideos: true,
  volume: 1,
  muted: false,
  soundEffects: true
}

export function groupKeyOf(item, mode) {
  if (mode === 'album') return item.album
  if (mode === 'month') return monthKey(item.takenAt)
  if (mode === 'type') return item.ext === '.gif' ? 'gif' : item.kind
  return 'all'
}

const TYPE_ORDER = { image: 0, video: 1, gif: 2 }

/* Oturum ilerlemesi için klasör başına başlangıç öğe sayısı.
   Ana süreçteki splitReviewByFolder ile aynı gruplama kuralını kullanır. */
function initialTotalsOf(items, mode) {
  const totals = {}
  const list = (items || []).filter(Boolean)
  if (mode === 'type') {
    const folder = typeScope(list)[0]
    if (folder) totals[folder.toLowerCase()] = list.length
    return totals
  }
  for (const item of list) {
    const folder = mode === 'album' ? folderOf(item?.path) : item?.root || folderOf(item?.path)
    if (!folder) continue
    const key = String(folder).replace(/[\\/]+$/, '').toLowerCase()
    totals[key] = (totals[key] || 0) + 1
  }
  return totals
}

/** Tür oturumunun kapsamı: seçilen türler tek bir anahtarda (ör. type:image). */
function typeScope(items) {
  const keys = [...new Set((items || []).filter(Boolean).map((item) => groupKeyOf(item, 'type')))]
  keys.sort((a, b) => (TYPE_ORDER[a] ?? 9) - (TYPE_ORDER[b] ?? 9))
  return keys.length ? [`type:${keys.join('+')}`] : []
}

function shuffle(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/* İnceleme sırası: sabit bir bağ ile hızlı karşılaştırma. */
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''))
/* Yol karşılaştırması: sağdaki ayraçları sil, küçük harfe al. */
const normPath = (value) => String(value || '').replace(/[\\/]+$/, '').toLowerCase()
const REVIEW_SORTS = {
  dateDesc: (a, b) => (b.takenAt || 0) - (a.takenAt || 0) || byName(a, b),
  dateAsc: (a, b) => (a.takenAt || 0) - (b.takenAt || 0) || byName(a, b),
  sizeDesc: (a, b) => (b.size || 0) - (a.size || 0) || byName(a, b),
  sizeAsc: (a, b) => (a.size || 0) - (b.size || 0) || byName(a, b)
}

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [stats, setStats] = useState({ sessions: [] })
  const [review, setReview] = useState(null)
  const [reviewSessions, setReviewSessions] = useState([])
  const [kept, setKept] = useState(() => new Set())
  const [library, setLibrary] = useState(null)
  const [rootStatus, setRootStatus] = useState([])
  const [scanProgress, setScanProgress] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [route, setRoute] = useState('home')
  const [flow, setFlow] = useState({ mode: 'album', selected: new Set(), random: 100 })
  const [done, setDone] = useState(null)
  const [toasts, setToasts] = useState([])
  const [busy, setBusy] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  // Çoklu oturum: aynı moddan ikinci oturum başlatılırken sorulan seçim (A/B).
  const [sessionChoice, setSessionChoice] = useState(null) // { state, conflicts: [] }
  const [version, setVersion] = useState('1.0.0')
  const [userData, setUserData] = useState('')
  const [booted, setBooted] = useState(false)
  const [systemDark, setSystemDark] = useState(true)
  const [resumePickerOpen, setResumePickerOpen] = useState(false)
  const persistTimer = useRef(null)
  const pendingPersist = useRef(null)
  const scanningRef = useRef(false)

  const lang = settings.lang
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US'
  const t = useCallback((key, vars) => translate(lang, key, vars), [lang])

  /* ---------- theme ---------- */

  useEffect(() => {
    preloadSounds()
  }, [])

  useEffect(() => {
    setSoundEnabled(settings.soundEffects !== false)
  }, [settings.soundEffects])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setSystemDark(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const resolved = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme
    document.documentElement.dataset.theme = resolved
  }, [settings.theme, systemDark])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  /* ---------- helpers ---------- */

  const pushToast = useCallback((text, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3200)
  }, [])

  /* Kaynak klasör canlı değilse (taşınmış, silinmiş, erişilemiyor) veya
     tarama 0 öğe bulduysa sessiz kalmak yerine kullanıcıya bildir. */
  const warnRootStatus = useCallback(
    (status) => {
      const issues = (status || []).filter((entry) => !entry.ok || entry.count === 0)
      if (!issues.length) return
      const first = issues[0]
      const key = !first.ok
        ? first.reason === 'unreadable'
          ? 'toast.rootUnreadable'
          : first.reason === 'not-directory'
            ? 'toast.rootNotFolder'
            : 'toast.rootMissing'
        : 'toast.rootEmpty'
      const extra = issues.length > 1 ? ` (+${issues.length - 1})` : ''
      pushToast(`${t(key, { name: first.path })}${extra}`, 'error')
    },
    [pushToast, t]
  )

  const writeReview = useCallback((state, roots, sessionId) => {
    if (state?.items?.length) return window.api.saveReview({ roots, review: state })
    return window.api.clearReview({ roots, sessionId: sessionId ?? null })
  }, [])

  const flushPersist = useCallback(async () => {
    clearTimeout(persistTimer.current)
    const job = pendingPersist.current
    pendingPersist.current = null
    if (!job) return
    try {
      const list = await writeReview(job.state, job.roots)
      if (Array.isArray(list)) setReviewSessions(list)
    } catch {
      /* yazma hatası bir sonraki kayıtta yeniden denenir */
    }
  }, [writeReview])

  const persistReview = useCallback(
    (state, roots) => {
      clearTimeout(persistTimer.current)
      pendingPersist.current = { state, roots: roots ?? state?.roots ?? settings.rootFolders }
      persistTimer.current = setTimeout(() => {
        flushPersist()
      }, 350)
    },
    [flushPersist, settings.rootFolders]
  )

  const rememberKept = useCallback((paths, keep) => {
    if (!paths?.length) return Promise.resolve()
    setKept((prev) => {
      const next = new Set(prev)
      for (const path of paths) {
        if (keep) next.add(path)
        else next.delete(path)
      }
      return next
    })
    return window.api.setKept(paths, keep).catch(() => {})
  }, [])

  // Tarama sonrası açık oturumu güncel kitaplıkla eşitle:
  // silinmiş dosyaları çıkar, kalanların boyut/tarih/albüm bilgisini tazele, konumu koru.
  const syncReview = useCallback(
    (items) => {
      const byPath = new Map(items.map((item) => [item.path, item]))
      setReview((prev) => {
        if (!prev?.items?.length) return prev
        const currentPath = prev.items[prev.i]?.path
        const nextItems = []
        for (const item of prev.items) {
          const fresh = byPath.get(item.path)
          if (fresh) nextItems.push(fresh)
        }

        if (!nextItems.length) {
          persistReview(null)
          return null
        }

        let i = Math.min(prev.i, nextItems.length)
        if (currentPath) {
          const position = nextItems.findIndex((entry) => entry.path === currentPath)
          if (position >= 0) {
            i = position
          } else {
            // Aktif öğe silinmiş: sıradaki ilk hayatta kalan öğeden devam et.
            i = nextItems.length
            for (let old = prev.i + 1; old < prev.items.length; old += 1) {
              const nextPosition = nextItems.findIndex((entry) => entry.path === prev.items[old].path)
              if (nextPosition >= 0) {
                i = nextPosition
                break
              }
            }
          }
        }

        const marks = {}
        for (const entry of nextItems) {
          const verdict = prev.marks?.[entry.path]
          if (verdict) marks[entry.path] = verdict
        }

        const unchanged =
          nextItems.length === prev.items.length &&
          nextItems.every((entry, position) => {
            const before = prev.items[position]
            return entry.path === before.path && entry.size === before.size && entry.takenAt === before.takenAt && entry.album === before.album
          }) &&
          Object.keys(marks).length === Object.keys(prev.marks || {}).length

        if (unchanged) return prev

        const next = { ...prev, items: nextItems, i, marks }
        persistReview(next)
        return next
      })
    },
    [persistReview]
  )

  const updateSettings = useCallback(async (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    await window.api.saveSettings(patch)
  }, [])

  /* ---------- scan ---------- */

  const scan = useCallback(
    async (roots, options = {}) => {
      const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean)
      if (!list.length) return
      if (scanningRef.current) {
        if (!options.quiet) pushToast(t('toast.scanBusy'), 'error')
        return
      }
      scanningRef.current = true
      setScanning(true)
      setScanProgress({ phase: 'walk', count: 0 })
      const off = window.api.onScanProgress((payload) => setScanProgress(payload))
      try {
        const result = await window.api.scan(list)
        setLibrary(result)
        setKept(new Set(result.kept || []))
        setRootStatus(result.rootStatus || [])
        warnRootStatus(result.rootStatus)
        const rootsChanged = sessionKey(settings.rootFolders) !== sessionKey(list)
        if (rootsChanged && !options.keepReview) {
          // Klasör kümesi değişti: açık oturum bellekte tutulmaz; kayıtlı
          // klasör oturumları evdeki kartlardan devam ettirilir.
          setReview(null)
        } else {
          syncReview(result.items)
        }
        await updateSettings({ rootFolders: list })
        setReviewSessions(await window.api.reviewSessions())
        if (!options.quiet) pushToast(t('toast.scanned', { n: result.items.length.toLocaleString(locale) }))
      } catch (error) {
        const message = String(error?.message || error)
        if (message.includes('SCAN_CANCELLED')) pushToast(t('toast.scanCancelled'), 'error')
        else if (message.includes('SCAN_BUSY')) pushToast(t('toast.scanBusy'), 'error')
        else pushToast(message, 'error')
      } finally {
        off()
        scanningRef.current = false
        setScanning(false)
        setScanProgress(null)
      }
    },
    [pushToast, t, locale, updateSettings, syncReview, settings.rootFolders, warnRootStatus]
  )

  const cancelScan = useCallback(() => {
    window.api.cancelScan().catch(() => {})
  }, [])

  const addFolder = useCallback(async () => {
    const folder = await window.api.pickFolder()
    if (!folder) return
    const current = settings.rootFolders || []
    if (current.includes(folder)) {
      pushToast(t('toast.folderExists'), 'error')
      return
    }
    await scan([...current, folder])
  }, [scan, settings.rootFolders, pushToast, t])

  const removeFolder = useCallback(
    async (folder) => {
      const next = (settings.rootFolders || []).filter((entry) => entry !== folder)
      // Klasörü listeden çıkarmadan önce mevcut ilerlemeyi kaydet.
      if (review?.items?.length) {
        try {
          setReviewSessions(await writeReview(review, review.roots?.length ? review.roots : settings.rootFolders))
        } catch {
          /* ignore */
        }
      }
      if (!next.length) {
        setLibrary(null)
        setReview(null)
        setDone(null)
        await updateSettings({ rootFolders: [] })
        setReviewSessions(await window.api.reviewSessions())
        return
      }
      await scan(next)
    },
    [scan, settings.rootFolders, updateSettings, review, writeReview]
  )

  /* ---------- bootstrap ---------- */

  useEffect(() => {
    let alive = true
    ;(async () => {
      const boot = await window.api.bootstrap()
      if (!alive) return
      setSettings({ ...DEFAULT_SETTINGS, ...boot.settings })
      setStats(boot.stats || { sessions: [] })
      setVersion(boot.version)
      setUserData(boot.userData)
      setKept(new Set(boot.kept || []))
      setRootStatus(boot.rootStatus || [])
      setReviewSessions(boot.reviewSessions || [])
      // Disk önbelleğini hemen göster: büyük klasörlerde açılış donmasını engeller.
      if (boot.library?.items?.length) setLibrary(boot.library)
      if (boot.review?.items?.length) setReview(boot.review)
      setBooted(true)
      const roots = Array.isArray(boot.settings?.rootFolders)
        ? boot.settings.rootFolders
        : boot.settings?.rootFolder
          ? [boot.settings.rootFolder]
          : []
      if (roots.length) scan(roots, { quiet: true })
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    clearTimeout(persistTimer.current)
  }, [])

  /* ---------- folder drag & drop ---------- */

  useEffect(() => {
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')
    const onOver = (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    }
    const onLeave = (event) => {
      if (!event.relatedTarget) setDragging(false)
    }
    const onDrop = async (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer.files?.[0]
      if (!file) return
      const dropped = window.api.pathForFile(file)
      if (!dropped) return
      const info = await window.api.pathInfo(dropped)
      if (!info) {
        pushToast(t('toast.noFolder'), 'error')
        return
      }
      const folder = info.isDirectory ? dropped : dropped.replace(/[\\/][^\\/]+$/, '')
      const current = settings.rootFolders || []
      if (current.includes(folder)) {
        pushToast(t('toast.folderExists'), 'error')
        return
      }
      await scan([...current, folder])
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [scan, settings.rootFolders, pushToast, t])

  /* ---------- review flow ---------- */

  const reviewableItems = useMemo(() => (library?.items || []).filter((item) => !kept.has(item.path)), [library, kept])

  const openFlow = useCallback(
    (mode) => {
      if (!reviewableItems.length) {
        pushToast(library?.items?.length ? t('toast.allKept') : t('toast.noFolder'), 'error')
        return
      }
      // Klasör/albüm seçimi varsayılan olarak boş: kullanıcı elle seçer.
      setFlow({ mode, selected: new Set(), random: Math.min(120, reviewableItems.length) })
      setRoute('select')
    },
    [library, reviewableItems, pushToast, t]
  )

  // Oturumu gerçekten başlatır; çakışma yoksa ya da kullanıcı seçim
  // yaptıysa çağrılır. sessionId verilirse bu yeni bir çoklu oturumdur.
  const launchReview = useCallback(
    (state, sessionId) => {
      const full = sessionId ? { ...state, sessionId } : state
      setDone(null)
      setReview(full)
      persistReview(full)
      setRoute('review')
    },
    [persistReview]
  )

  const startReview = useCallback(
    (items, mode) => {
      // Oturum kapsamı: albüm modunda her klasör/alt klasör ayrı oturum,
      // diğer modlarda kök klasör. Böylece Camera1'den Camera2'ye geçince
      // Camera1'in işaretleri korunur.
      const usable = (items || []).filter((item) => item && !kept.has(item.path))
      if (!usable.length) {
        pushToast(t('toast.allKept'), 'error')
        return
      }
      const scopedRoots = []
      for (const item of usable) {
        if (item?.root && !scopedRoots.includes(item.root)) scopedRoots.push(item.root)
      }
      const roots = scopedRoots.length ? scopedRoots : settings.rootFolders
      const typed = mode === 'type' ? typeScope(usable) : []
      const scope = mode === 'album' ? folderScope(usable, roots) : typed.length ? typed : roots
      // Önceki oturumun bekleyen otomatik kaydını kaybetme.
      flushPersist()
      const state = {
        items: usable,
        i: 0,
        marks: {},
        startedAt: Date.now(),
        mode,
        roots,
        scope,
        sort: 'session',
        baseOrder: usable.map((item) => item.path),
        initialTotal: usable.length,
        initialTotals: initialTotalsOf(usable, mode)
      }
      // Çakışma denetimi: aynı modda ve aynı kökleri kapsayan kayıtlı/açık oturum varsa sor.
      const rootSet = new Set(roots.map(normPath))
      const overlaps = (list) => (list || []).some((root) => rootSet.has(normPath(root)))
      const conflicts = reviewSessions.filter((entry) => (entry.mode || 'album') === mode && overlaps(entry.roots))
      const openConflict =
        review && review.i < review.items.length && (review.mode || 'album') === mode && overlaps(review.roots)
      if (conflicts.length || openConflict) {
        // Açık oturumun bekleyen kaydını gecikmeden yaz; sonra seçimi sor.
        flushPersist()
        setSessionChoice({ state, conflicts })
        return
      }
      launchReview(state, null)
    },
    [kept, pushToast, t, settings.rootFolders, flushPersist, reviewSessions, review, launchReview]
  )

  const mark = useCallback(
    (verdict) => {
      if (!review || review.i >= review.items.length) return
      const item = review.items[review.i]
      const marks = { ...review.marks }
      if (verdict) marks[item.path] = verdict
      const next = { ...review, marks, i: review.i + 1 }
      setReview(next)
      persistReview(next)
      if (verdict === 'keep') rememberKept([item.path], true)
    },
    [review, persistReview, rememberKept]
  )

  const undo = useCallback(() => {
    if (!review || review.i === 0) return
    const index = review.i - 1
    const item = review.items[index]
    const marks = { ...review.marks }
    delete marks[item.path]
    const next = { ...review, i: index, marks }
    setReview(next)
    persistReview(next)
    if (review.marks?.[item.path] === 'keep') rememberKept([item.path], false)
  }, [review, persistReview, rememberKept])

  /* Toplu seçim (inceleme film şeridinden): tut anında kalıcı,
     sil yalnızca işaretler (silme özet/uygulama aşamasında). */
  const bulkMark = useCallback(
    (paths, verdict) => {
      if (!review || !paths?.length || !verdict) return
      const set = new Set(paths)
      const marks = { ...review.marks }
      const keptPaths = []
      for (const item of review.items) {
        if (!set.has(item.path)) continue
        marks[item.path] = verdict
        if (verdict === 'keep') keptPaths.push(item.path)
      }
      const next = { ...review, marks }
      setReview(next)
      persistReview(next)
      if (keptPaths.length) rememberKept(keptPaths, true)
    },
    [review, persistReview, rememberKept, kept]
  )

  const discardReview = useCallback(async () => {
    const roots = review?.roots?.length ? review.roots : settings.rootFolders
    const scope = review?.scope?.length ? review.scope : roots
    const mode = review?.mode || 'album'
    // İptal edilen oturumdaki "Tut" kararları da geri alınır; aksi hâlde
    // kept.json'a anında yazılan öğeler işlenmiş gibi kalıyordu.
    const marks = review?.marks || {}
    const keptPaths = (review?.items || [])
      .filter((item) => marks[item.path] === 'keep')
      .map((item) => item.path)
    if (keptPaths.length) await rememberKept(keptPaths, false)
    setReview(null)
    setDone(null)
    clearTimeout(persistTimer.current)
    pendingPersist.current = null
    setRoute('home')
    try {
      setReviewSessions(await window.api.clearReview({ roots, scope, mode, sessionId: review?.sessionId || null }))
    } catch {
      /* ignore */
    }
  }, [review, settings.rootFolders, rememberKept])

  const finishStats = useCallback(
    async ({ mode, reviewed, kept: keptCount, deleted, skipped, bytes, startedAt }) => {
      const session = {
        id: crypto.randomUUID(),
        date: Date.now(),
        mode,
        reviewed,
        kept: keptCount,
        deleted,
        skipped,
        bytes,
        durationMs: Math.max(0, Date.now() - (startedAt || Date.now()))
      }
      const nextStats = await window.api.addSession(session)
      setStats(nextStats)
      return session
    },
    []
  )

  const dropFromLibrary = useCallback((paths) => {
    const set = new Set(paths)
    setLibrary((prev) => (prev ? { ...prev, items: prev.items.filter((item) => !set.has(item.path)) } : prev))
  }, [])

  // Kalan öğelerden devam oturumu üretir; konum her zaman ilk incelenmemiş öğedir.
  const buildRemainingReview = useCallback((state, items, roots) => {
    if (!items?.length) return null
    const typedLeft = state.mode === 'type' ? typeScope(items) : []
    const nextScope = state.mode === 'album' ? folderScope(items, roots) : typedLeft.length ? typedLeft : roots
    const remainingPaths = new Set(items.map((item) => item.path))
    const nextBaseOrder = (state.baseOrder?.length ? state.baseOrder : state.items.map((item) => item.path)).filter(
      (path) => remainingPaths.has(path)
    )
    return {
      items,
      i: 0,
      marks: {},
      startedAt: Date.now(),
      mode: state.mode,
      roots,
      scope: nextScope,
      sort: state.sort || 'session',
      baseOrder: nextBaseOrder,
      initialTotal: state.initialTotal,
      initialTotals: state.initialTotals || initialTotalsOf(state.items, state.mode),
      sessionId: state.sessionId
    }
  }, [])

  // Doğal son: incelenen her şey uygulanır, özet gösterilir.
  const applyReview = useCallback(async () => {
    if (!review) return
    const roots = review.roots?.length ? review.roots : settings.rootFolders
    const scope = review.scope?.length ? review.scope : roots
    const marks = review.marks || {}
    const deletions = review.items.filter((item) => marks[item.path] === 'delete')
    const keptCount = review.items.filter((item) => marks[item.path] === 'keep').length
    const skipped = review.items.filter((item) => marks[item.path] === 'skip').length
    const bytes = deletions.reduce((sum, item) => sum + item.size, 0)
    const paths = deletions.map((item) => item.path)

    setBusy(true)
    let failed = []
    if (paths.length) {
      const result = settings.deleteMode === 'trash' ? await window.api.trash(paths) : await window.api.destroy(paths)
      failed = result.failed || []
    }

    const failedSet = new Set(failed)
    const removedPaths = paths.filter((path) => !failedSet.has(path))
    const removed = removedPaths.length
    const removedSet = new Set(removedPaths)
    // Karar verilmemiş öğeler (ve silinemeyenler) oturumda kalır.
    const remainingItems = review.items.filter(
      (item) =>
        (!marks[item.path] || (marks[item.path] === 'delete' && failedSet.has(item.path))) &&
        !removedSet.has(item.path) &&
        !kept.has(item.path)
    )
    const nextReview = buildRemainingReview(review, remainingItems, roots)
    const session = await finishStats({
      mode: review.mode,
      reviewed: review.items.length - remainingItems.length,
      kept: keptCount,
      deleted: removed,
      skipped,
      bytes: removed > 0 ? Math.round((bytes * removed) / Math.max(1, paths.length)) : 0,
      startedAt: review.startedAt
    })

    if (removed > 0) dropFromLibrary(removedPaths)

    setReview(null)
    clearTimeout(persistTimer.current)
    pendingPersist.current = null
    try {
      await window.api.clearReview({ roots, scope, mode: review.mode, sessionId: review.sessionId || null })
      setReviewSessions(nextReview ? await writeReview(nextReview, roots) : await window.api.reviewSessions())
    } catch {
      /* ignore */
    }
    setDone({
      session,
      failed: failed.length,
      remaining: remainingItems.length,
      resume: remainingItems.length > 0,
      paused: remainingItems.length > 0
    })
    playSound('finish')
    setBusy(false)
    if (failed.length) pushToast(t('toast.failed', { n: failed.length }), 'error')
    else if (removed > 0) pushToast(settings.deleteMode === 'trash' ? t('toast.trashed', { n: removed }) : t('toast.deleted', { n: removed }))
  }, [review, settings.deleteMode, settings.rootFolders, finishStats, dropFromLibrary, pushToast, t, kept, buildRemainingReview, writeReview])

  // "Devam et": oturumu kapat. Silinecek varsa seçimli silme; sonra özet.
  const pauseSession = useCallback(
    async ({ mode, paths } = {}) => {
      if (!review) return
      const roots = review.roots?.length ? review.roots : settings.rootFolders
      const marks = review.marks || {}
      const deletions = paths
        ? review.items.filter((item) => paths.includes(item.path))
        : review.items.filter((item) => marks[item.path] === 'delete')

      if (!deletions.length) {
        // Konum sona taşınmış olsa bile ilk karar verilmemiş öğeden devam edilir.
        // Atlanan öğelerin işaretleri korunur.
        const firstUnmarked = review.items.findIndex((item) => !marks[item.path] && !kept.has(item.path))
        const next = firstUnmarked >= 0 ? { ...review, i: Math.min(review.i, firstUnmarked) } : review
        clearTimeout(persistTimer.current)
        pendingPersist.current = null
        setReview(null)
        setDone(null)
        try {
          setReviewSessions(await writeReview(next, roots))
        } catch {
          /* ignore */
        }
        setRoute('home')
        pushToast(t('toast.sessionSaved'))
        return
      }

      const keptCount = review.items.filter((item) => marks[item.path] === 'keep').length
      const skipped = review.items.filter((item) => marks[item.path] === 'skip').length
      const bytes = deletions.reduce((sum, item) => sum + item.size, 0)
      const deletePaths = deletions.map((item) => item.path)
      const deleteSet = new Set(deletePaths)
      const method = mode || settings.deleteMode

      setBusy(true)

      // Çöp kutusu işlemi dosya başına zaman alıyor. Özet hemen gösterilir,
      // silme sürerken sonuçlar tamamlanınca tazelenir; böylece kalıcı silme
      // ile çöp kutusu arasındaki bildirim gecikmesi ortadan kalkar.
      const plannedRemaining = review.items.filter(
        (item) => !deleteSet.has(item.path) && marks[item.path] !== 'keep' && !kept.has(item.path)
      )
      clearTimeout(persistTimer.current)
      pendingPersist.current = null
      setReview(null)
      setDone({
        session: {
          mode: review.mode,
          reviewed: review.items.length - plannedRemaining.length,
          kept: keptCount,
          deleted: deletePaths.length,
          skipped,
          bytes,
          startedAt: review.startedAt
        },
        failed: 0,
        remaining: plannedRemaining.length,
        resume: plannedRemaining.length > 0,
        paused: true
      })
      playSound('finish')

      const result = method === 'trash' ? await window.api.trash(deletePaths) : await window.api.destroy(deletePaths)
      const failed = result.failed || []
      const failedSet = new Set(failed)
      const removedPaths = deletePaths.filter((path) => !failedSet.has(path))
      const removed = removedPaths.length
      const removedSet = new Set(removedPaths)

      // Silinenler ve tutulanlar çıkar; atlananlar / silinemeyenler işaretleriyle kalır.
      const remainingItems = review.items.filter(
        (item) => !removedSet.has(item.path) && marks[item.path] !== 'keep' && !kept.has(item.path)
      )
      const remainingMarks = {}
      for (const item of remainingItems) {
        if (marks[item.path]) remainingMarks[item.path] = marks[item.path]
      }
      const nextUnmarked = remainingItems.findIndex((item) => !remainingMarks[item.path])
      const nextReview = remainingItems.length
        ? {
            ...buildRemainingReview(review, remainingItems, roots),
            i: nextUnmarked >= 0 ? nextUnmarked : 0,
            marks: remainingMarks
          }
        : null
      const session = await finishStats({
        mode: review.mode,
        reviewed: review.items.length - remainingItems.length,
        kept: keptCount,
        deleted: removed,
        skipped,
        bytes: removed > 0 ? Math.round((bytes * removed) / Math.max(1, deletePaths.length)) : 0,
        startedAt: review.startedAt
      })

      if (removed > 0) dropFromLibrary(removedPaths)

      try {
        // Kapsamdaki eski kayıtları temizle, kalanı klasör başına yaz.
        await window.api.clearReview({ roots, scope: review.scope, mode: review.mode, sessionId: review.sessionId || null })
        setReviewSessions(nextReview ? await writeReview(nextReview, roots) : await window.api.reviewSessions())
      } catch {
        /* ignore */
      }

      // Kullanıcı bu arada başka ekrana geçtiyse özeti güncelleme.
      setDone((previous) =>
        previous
          ? {
              ...previous,
              session,
              failed: failed.length,
              remaining: remainingItems.length,
              resume: remainingItems.length > 0
            }
          : previous
      )
      setBusy(false)
      if (failed.length) pushToast(t('toast.failed', { n: failed.length }), 'error')
      else if (removed > 0) pushToast(method === 'trash' ? t('toast.trashed', { n: removed }) : t('toast.deleted', { n: removed }))
    },
    [review, settings.rootFolders, settings.deleteMode, writeReview, finishStats, dropFromLibrary, pushToast, t, kept, buildRemainingReview]
  )

  const jumpTo = useCallback(
    (index) => {
      if (!review) return
      const total = review.items?.length || 0
      const next = { ...review, i: Math.max(0, Math.min(index, total)) }
      setReview(next)
      persistReview(next)
    },
    [review, persistReview]
  )

  // İnceleme sırasında listeyi sırala. İncelenmiş baş kısım [0, i) sabit kalır;
  // kalan tüm öğeler (mevcut öğe dahil) seçilen ölçüte göre yeniden dizilir.
  // "Sıra" seçeneği oturum başındaki dizilimi geri getirir.
  const reorderReview = useCallback(
    (sortKey) => {
      if (!review) return
      const key = REVIEW_SORTS[sortKey] ? sortKey : 'session'
      const total = review.items?.length || 0
      const i = Math.max(0, Math.min(review.i || 0, total))
      const head = review.items.slice(0, i)
      const rest = review.items.slice(i)
      const baseOrder = review.baseOrder?.length ? review.baseOrder : review.items.map((item) => item.path)
      const baseIndex = new Map(baseOrder.map((path, index) => [path, index]))
      const sorted = [...rest].sort(
        key === 'session'
          ? (a, b) => (baseIndex.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (baseIndex.get(b.path) ?? Number.MAX_SAFE_INTEGER)
          : REVIEW_SORTS[key]
      )
      const next = { ...review, items: [...head, ...sorted], sort: key, baseOrder }
      setReview(next)
      persistReview(next)
    },
    [review, persistReview]
  )

  const bulkAction = useCallback(
    async (paths, mode = 'trash') => {
      if (!paths.length) return
      setBusy(true)
      const items = (library?.items || []).filter((item) => paths.includes(item.path))
      const bytes = items.reduce((sum, item) => sum + item.size, 0)
      const result = mode === 'trash' ? await window.api.trash(paths) : await window.api.destroy(paths)
      const failed = result.failed || []
      const removed = paths.length - failed.length
      if (removed > 0) {
        const failedSet = new Set(failed)
        const removedPaths = paths.filter((path) => !failedSet.has(path))
        await finishStats({
          mode: 'gallery',
          reviewed: paths.length,
          kept: 0,
          deleted: removed,
          skipped: failed.length,
          bytes: Math.round((bytes * removed) / paths.length),
          startedAt: Date.now()
        })
        dropFromLibrary(removedPaths)
        pushToast(mode === 'trash' ? t('toast.trashed', { n: removed }) : t('toast.deleted', { n: removed }))
      }
      if (failed.length) pushToast(t('toast.failed', { n: failed.length }), 'error')
      setBusy(false)
    },
    [library, finishStats, dropFromLibrary, pushToast, t]
  )

  // Galeriden seçilenleri incelemeye aktar.
  const reviewSelected = useCallback(
    (items) => {
      if (!items?.length) return
      startReview(items, 'gallery')
    },
    [startReview]
  )

  const resumeSession = useCallback(
    async (entry) => {
      if (!entry?.key) return
      const saved = await window.api.getReview(entry.key)
      if (!saved?.items?.length) {
        pushToast(t('toast.allKept'), 'error')
        setReviewSessions(await window.api.reviewSessions())
        return
      }
      // Klasör listesini değiştirmeyiz: kaldırılan klasörler geri gelmez.
      setReview({
        ...saved,
        roots: saved.roots?.length ? saved.roots : entry.roots || [],
        scope: saved.scope?.length ? saved.scope : entry.scope || entry.roots || [],
        sort: saved.sort || 'session',
        baseOrder: saved.baseOrder?.length ? saved.baseOrder : (saved.items || []).map((item) => item.path),
        initialTotals: saved.initialTotals || initialTotalsOf(saved.items, saved.mode || 'album')
      })
      setDone(null)
      setRoute('review')
    },
    [pushToast, t]
  )

  // Kayıtlı oturumu açmadan doğrudan kapat (çarpı): gerçekte diskten siler.
  const removeSession = useCallback(
    async (entry) => {
      if (!entry?.key) return
      const norm = (value) => String(value || '').replace(/[\\/]+$/, '').toLowerCase()
      const sameScope = (a, b) => {
        const left = (Array.isArray(a) ? a : a ? [a] : []).map(norm)
        const right = (Array.isArray(b) ? b : b ? [b] : []).map(norm)
        return left.length === right.length && left.every((value) => right.includes(value))
      }
      try {
        const list = await window.api.clearReview({
          roots: entry.roots,
          scope: entry.scope?.length ? entry.scope : entry.roots,
          mode: entry.mode,
          sessionId: entry.sessionId || null
        })
        setReviewSessions(list)
        // Kapatılan oturum bellekte açık duran oturumsa onu da temizle;
        // aksi halde "devam et" kartı boş oturumu göstermeye devam eder.
        if (
          review &&
          (review.mode || 'album') === (entry.mode || 'album') &&
          sameScope(review.scope?.length ? review.scope : review.roots, entry.scope?.length ? entry.scope : entry.roots)
        ) {
          clearTimeout(persistTimer.current)
          pendingPersist.current = null
          setReview(null)
          setDone(null)
        }
        pushToast(t('toast.sessionClosed'))
      } catch {
        /* ignore */
      }
    },
    [pushToast, t, review]
  )

  // Çarpıya basınca önce ikinci bir onay iste.
  const discardSession = useCallback(
    (entry) => {
      if (!entry?.key) return
      setConfirmState({
        title: t('home.closeSession'),
        body: t('home.closeSessionConfirm', { name: scopeLabel(entry.scope, entry.roots, t) }),
        icon: 'x',
        danger: true,
        confirmLabel: t('home.closeSession'),
        onConfirm: () => removeSession(entry)
      })
    },
    [removeSession, t]
  )

  // "Kaldığınız yerden devam edin": tek oturum varsa doğrudan aç,
  // birden fazla klasör oturumu varsa hangisi olduğunu sor.
  const openResumePicker = useCallback(async () => {
    const list = await window.api.reviewSessions()
    setReviewSessions(list)
    if (!list.length) {
      setRoute('home')
      pushToast(t('toast.allKept'), 'error')
      return
    }
    if (list.length === 1) {
      await resumeSession(list[0])
      return
    }
    setResumePickerOpen(true)
  }, [resumeSession, pushToast, t])

  const totals = useMemo(() => {
    const items = library?.items || []
    return {
      count: items.length,
      bytes: items.reduce((sum, item) => sum + item.size, 0)
    }
  }, [library])

  const grandTotals = useMemo(() => {
    const sessions = stats.sessions || []
    return {
      bytes: sessions.reduce((sum, session) => sum + (session.bytes || 0), 0),
      reviewed: sessions.reduce((sum, session) => sum + (session.reviewed || 0), 0),
      deleted: sessions.reduce((sum, session) => sum + (session.deleted || 0), 0),
      kept: sessions.reduce((sum, session) => sum + (session.kept || 0), 0),
      sessions: sessions.length
    }
  }, [stats])

  const askConfirm = useCallback((options) => setConfirmState(options), [])

  // Onaydan sonra: kayıtları taşı, kök durumunu tazele, taramayı yenile.
  const applyRootFix = useCallback(async ({ from, to }) => {
    try {
      const result = await window.api.replaceRoot(from, to)
      setSettings(result.settings)
      setKept(new Set(result.kept || []))
      setReviewSessions(result.sessions || [])
      setRootStatus((prev) =>
        prev.map((entry) => (normPath(entry.path) === normPath(from) ? { ...entry, path: to, ok: true, reason: null } : entry))
      )
      pushToast(t('toast.rootFixed'))
      const list = result.settings?.rootFolders?.length ? result.settings.rootFolders : settings.rootFolders
      if (list?.length) scan(list)
    } catch (error) {
      pushToast(t('toast.rootFixFailed'), 'error')
    }
  }, [pushToast, t, settings.rootFolders, scan])

  /* Bozuk kaynak klasörü düzelt: kullanıcı doğru yolu seçer,
     taşıma onayı "Düzelt"te sorulur, sonra kayıtlar taşınır ve tarama yenilenir. */
  const fixFolder = useCallback(async (folder) => {
    const picked = await window.api.pickFolder()
    if (!picked) return
    if (normPath(picked) === normPath(folder)) return
    setConfirmState({
      title: t('root.fixTitle'),
      body: t('root.fixBody', { from: folder, to: picked }),
      icon: 'info',
      confirmLabel: t('root.fix'),
      onConfirm: () => applyRootFix({ from: folder, to: picked })
    })
  }, [t, applyRootFix])

  const clearCache = useCallback(async () => {
    const statsNow = await window.api.clearThumbs()
    pushToast(t('toast.cacheCleared'))
    return statsNow
  }, [pushToast, t])

  /* ---------- render ---------- */

  const screens = {
    home: (
      <Home
        library={library}
        totals={totals}
        grandTotals={grandTotals}
        scanProgress={scanProgress}
        scanning={scanning}
        review={review}
        settings={settings}
        sessions={reviewSessions}
        kept={kept}
        reviewable={reviewableItems}
        rootStatus={rootStatus}
        onPick={addFolder}
        onAddFolder={addFolder}
        onCancelScan={cancelScan}
        onOpenFlow={openFlow}
        onChooseSession={openResumePicker}
        onResumeSession={resumeSession}
        onDiscardSession={discardSession}
        onNavigate={setRoute}
      />
    ),
    select: (
      <Select
        mode={flow.mode}
        library={{ ...(library || {}), items: reviewableItems }}
        flow={flow}
        setFlow={setFlow}
        onBack={() => setRoute('home')}
        onStart={startReview}
      />
    ),
    review: (
      <Review
        review={review}
        settings={settings}
        done={done}
        busy={busy}
        onMark={mark}
        onUndo={undo}
        onApply={applyReview}
        onPause={pauseSession}
        onJump={jumpTo}
        onSort={reorderReview}
        onAudioChange={updateSettings}
        onDiscard={discardReview}
        onConfirm={askConfirm}
        onHome={() => {
          setDone(null)
          setRoute('home')
        }}
        onNewSession={() => {
          setDone(null)
          setRoute('home')
          openFlow('album')
        }}
        onResume={() => {
          setDone(null)
          setRoute('home')
          openResumePicker()
        }}
        onBulkMark={bulkMark}
      />
    ),
    gallery: (
      <Gallery
        library={library}
        items={library?.items || []}
        settings={settings}
        busy={busy}
        onBulk={bulkAction}
        onConfirm={askConfirm}
        onPick={addFolder}
        onReview={reviewSelected}
        totals={totals}
        kept={kept}
        onOpenFolder={(folder) => folder && window.api.openFile(folder)}
      />
    ),
    stats: <Stats stats={stats} totals={grandTotals} />,
    settings: (
      <Settings
        settings={settings}
        onChange={async (patch) => {
          await updateSettings(patch)
          if ('showVideos' in patch && settings.rootFolders?.length) scan(settings.rootFolders)
        }}
        onResetStats={async () => {
          const next = await window.api.resetStats()
          setStats(next)
          pushToast(t('toast.reset'))
        }}
        onOpenData={() => userData && window.api.openFile(userData)}
        onPick={addFolder}
        onRemoveFolder={removeFolder}
        onRescan={() => scan(settings.rootFolders)}
        version={version}
        userData={userData}
        onConfirm={askConfirm}
        onClearCache={clearCache}
        rootStatus={rootStatus}
        onFixFolder={fixFolder}
      />
    )
  }

  if (!booted) {
    return (
      <div className="app">
        <TitleBar />
        <div className="boot">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  return (
    <I18nContext.Provider value={{ lang, locale, t }}>
      <div className={`app route-${route} ${dragging ? 'is-dragging' : ''}`}>
        <TitleBar />
        <div className="shell">
          <Sidebar
            route={route}
            onNavigate={setRoute}
            items={totals.count}
            sizeLabel={formatBytes(totals.bytes, lang)}
            t={t}
            review={review && review.i < review.items.length ? review : null}
          />
          <div className="content">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={route}
                className="screen-motion"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                {screens[route] || screens.home}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {dragging ? (
            <motion.div
              className="drop-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              <div className="drop-card">
                <div className="drop-icon">
                  <Icon name="folder" size={26} />
                </div>
                <div className="drop-title">{t('home.dropFolder')}</div>
                <div className="drop-sub">{t('home.dropSub')}</div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Toasts toasts={toasts} />
        <AnimatePresence>
          {resumePickerOpen ? (
            <ResumePicker
              sessions={reviewSessions}
              onClose={() => setResumePickerOpen(false)}
              onPick={(entry) => {
                setResumePickerOpen(false)
                resumeSession(entry)
              }}
              onDiscard={discardSession}
              t={t}
              locale={locale}
            />
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {sessionChoice ? (
            <SessionChoiceModal
              flow={sessionChoice}
              t={t}
              locale={locale}
              onClose={() => setSessionChoice(null)}
              onPick={(choice) => {
                const { state, conflicts } = sessionChoice
                setSessionChoice(null)
                if (choice === 'new') {
                  launchReview(state, crypto.randomUUID())
                  return
                }
                // Önceki oturumları sonlandır, sonra başlat.
                const keys = conflicts.map((entry) => entry.key)
                window.api
                  .dropSessions(keys)
                  .then((list) => setReviewSessions(list))
                  .catch(() => {})
                launchReview(state, null)
              }}
            />
          ) : null}
        </AnimatePresence>
        <AnimatePresence>{confirmState ? <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} t={t} /> : null}</AnimatePresence>
      </div>
    </I18nContext.Provider>
  )
}

function ResumePicker({ sessions, onClose, onPick, onDiscard, t, locale }) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal resume-picker"
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-title">{t('home.chooseSession')}</div>
        <div className="modal-body">{t('home.chooseSessionSub')}</div>
        <div className="resume-picker-list">
          {sessions.map((entry) => {
            const reviewed = Math.max(0, entry.total - entry.remaining)
            const pct = entry.total ? Math.round((reviewed / entry.total) * 100) : 0
            return (
              <div
                key={entry.key}
                className="resume-option"
                role="button"
                tabIndex={0}
                onClick={() => onPick(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onPick(entry)
                  }
                }}
              >
                <span className="saved-session-icon">
                  <Icon name="folder" size={16} />
                </span>
                <span className="saved-session-main">
                  <span className="saved-session-name" title={scopeLabel(entry.scope, entry.roots, t)}>
                    {scopeLabel(entry.scope, entry.roots, t)}
                  </span>
                  <span className="saved-session-sub">
                    {t('home.sessionRemaining', { n: entry.remaining.toLocaleString(locale) })} · {t(`stats.mode.${entry.mode || 'album'}`)}
                  </span>
                  <span className="saved-session-meter">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </span>
                <span className="saved-session-side">
                  <span className="btn btn-sm btn-primary">{t('home.resumeSession')}</span>
                </span>
                <button
                  type="button"
                  className="resume-option-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    onDiscard(entry)
                  }}
                  title={t('home.closeSession')}
                  aria-label={t('home.closeSession')}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* Aynı moddan ikinci oturum başlatılırken sorulan seçim:
   A) öncekini sonlandır ve başlat  B) ayrı yeni oturum olarak başlat. */
function SessionChoiceModal({ flow, onClose, onPick, t }) {
  const { conflicts } = flow
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal"
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-icon">
          <Icon name="layers" size={22} />
        </div>
        <div className="modal-title">{t('home.sessionConflictTitle')}</div>
        <div className="modal-body">{t('home.sessionConflictBody', { n: conflicts.length })}</div>
        <div className="modal-actions session-choice-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn" onClick={() => onPick('new')}>
            {t('home.sessionConflictNew')}
          </button>
          <button className="btn btn-danger" onClick={() => onPick('end')}>
            {t('home.sessionConflictEnd')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ConfirmModal({ state, onClose, t }) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal"
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-icon">
          <Icon name={state.icon || (state.danger ? 'trash' : 'info')} size={22} />
        </div>
        <div className="modal-title">{state.title}</div>
        {state.body && <div className="modal-body">{state.body}</div>}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onClose()
              state.onConfirm?.()
            }}
          >
            {state.confirmLabel || t('common.confirm')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
