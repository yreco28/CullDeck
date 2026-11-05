import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useTransform } from 'framer-motion'
import Icon from '../components/Icon'
import { Empty, FullscreenViewer, MediaFallback, MediaInfoModal, Thumb } from '../components/ui'
import { useI18n } from '../i18n'
import { formatBytes, percent, relativeTime } from '../lib/format'
import { needsExternalPlayer, needsShellPreview } from '../lib/mediaSupport'
import { playSound } from '../lib/sound'

const clock = (value) => {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const total = Math.floor(value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const SPEEDS = [0.5, 1, 1.5, 2]

/* Film şeridi: öğe genişliği 46 px + 8 px boşluk. Sabit adım sayesinde
   yalnızca görünen pencere (± tampon) render edilir; binlerce öğeli
   oturumlarda DOM ve küçük resim sayısı sabit kalır. */
const STRIP_STEP = 54
const STRIP_OVERSCAN = 14

export default function Review({ review, settings, done, busy, onMark, onUndo, onApply, onPause, onJump, onSort, onAudioChange, onDiscard, onConfirm, onHome, onNewSession, onResume, onBulkMark }) {
  const { t, lang, locale } = useI18n()
  const x = useMotionValue(0)
  const opacity = useMotionValue(1)
  const rotate = useTransform(x, [-420, 0, 420], [-7, 0, 7])
  const dragControls = useDragControls()
  const [flying, setFlying] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const videoRef = useRef(null)
  const stripRef = useRef(null)
  const stripDrag = useRef({ active: false, startX: 0, startLeft: 0, moved: false, velocity: 0, lastX: 0, lastAt: 0 })
  const skipStripClick = useRef(false)
  const momentumFrame = useRef(0)
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(Boolean(settings.muted))
  const audioTimer = useRef(0)
  const resumeAfterFullscreen = useRef(false)
  const [volume, setVolume] = useState(() =>
    typeof settings.volume === 'number' ? Math.max(0, Math.min(1, settings.volume)) : 1
  )
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rate, setRate] = useState(1)
  const [pauseOpen, setPauseOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [shellThumb, setShellThumb] = useState(null)
  const [pauseSelection, setPauseSelection] = useState(() => new Set())
  // Toplu seçim: film şeridinden tek tek ek / çıkar, sonra tut ya da sil.
  const [selecting, setSelecting] = useState(false)
  const [bulkSel, setBulkSel] = useState(() => new Set())
  // Şeritte yalnızca görünen aralık (sanallaştırma).
  const [stripWindow, setStripWindow] = useState(() => {
    const count = review?.items?.length || 0
    const at = review?.i ?? 0
    const start = Math.max(0, at - STRIP_OVERSCAN)
    return { start, end: Math.min(count, start + STRIP_OVERSCAN * 2 + 24) }
  })
  const leftDelete = settings.swipe !== 'right-delete'
  const leftVerdict = leftDelete ? 'delete' : 'keep'
  const rightVerdict = leftDelete ? 'keep' : 'delete'

  const leftOpacity = useTransform(x, [-190, -40, 0], [1, 0.2, 0])
  const rightOpacity = useTransform(x, [0, 40, 190], [0, 0.2, 1])

  const total = review?.items?.length || 0
  const index = review?.i ?? 0
  const item = review?.items?.[Math.min(index, Math.max(0, total - 1))]
  const finished = review ? index >= total : false

  useEffect(() => {
    setPlaying(true)
    setProgress(0)
    setDuration(0)
    setVideoFailed(false)
    setImageFailed(false)
    setShellThumb(null)
  }, [item?.path])

  // Ses seviyesi ve sessizlik her videoda korunur; ayar diske de yazılır.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = muted
  }, [volume, muted, item?.path])

  useEffect(() => () => clearTimeout(audioTimer.current), [])

  // Tam ekran açılınca arkadaki video durur; böylece iki ses üst üste binmez.
  // Tam ekran kapanınca, açılmadan önce oynuyorsa kaldığı yerden devam eder.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (fullscreen) {
      resumeAfterFullscreen.current = !video.paused
      video.pause()
    } else if (resumeAfterFullscreen.current) {
      resumeAfterFullscreen.current = false
      video.play().catch(() => {})
    }
  }, [fullscreen])

  // Tam ekranda gezinirken yeni arka plan videosu da başlamasın.
  useEffect(() => {
    if (fullscreen) videoRef.current?.pause()
  }, [fullscreen, item?.path])

  // TIFF/HEIC gibi tarayıcının çözemediği görseller için Windows önizlemesi.
  const shellImage = Boolean(item && needsShellPreview(item))
  useEffect(() => {
    if (!item?.path || !shellImage) return undefined
    let alive = true
    window.api
      .thumb(item.path, 1600)
      .then((result) => {
        if (alive && result) setShellThumb(result)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [item?.path, shellImage])

  // Görünür aralığı kaydırma konumundan hesapla.
  const syncStripWindow = useCallback(() => {
    const strip = stripRef.current
    const count = review?.items?.length || 0
    if (!strip || !count) return
    const start = Math.max(0, Math.floor((strip.scrollLeft - 10) / STRIP_STEP) - STRIP_OVERSCAN)
    const span = Math.ceil((strip.clientWidth || 0) / STRIP_STEP) + STRIP_OVERSCAN * 2 + 2
    const end = Math.min(count, start + span)
    setStripWindow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [review?.items?.length])

  useEffect(() => {
    syncStripWindow()
    window.addEventListener('resize', syncStripWindow)
    return () => window.removeEventListener('resize', syncStripWindow)
  }, [syncStripWindow])

  // Aktif fotoğrafın küçük resmini şeridin ortasına getir (boyutlar değişmeden).
  // Sanallaştırma nedeniyle konum, sabit adımdan hesaplanır.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || !total) return
    const center = 10 + index * STRIP_STEP + 46 / 2
    const target = Math.max(0, center - strip.clientWidth / 2)
    if (Math.abs(strip.scrollLeft - target) < 1) return
    const far = Math.abs(strip.scrollLeft - target) > strip.clientWidth * 2
    strip.scrollTo({ left: target, behavior: far ? 'auto' : 'smooth' })
  }, [index, total])

  // Oturum değişince (veya imleç pencerenin dışına atlayınca) pencereyi
  // geçerli öğenin çevresine taşı; aksi hâlde boş şerit görünebilir.
  useEffect(() => {
    setStripWindow((prev) => {
      if (!total) return { start: 0, end: 0 }
      if (index >= prev.start && index < prev.end && prev.end <= total) return prev
      const start = Math.max(0, Math.min(index - STRIP_OVERSCAN, total - 1))
      return { start, end: Math.min(total, start + STRIP_OVERSCAN * 2 + 24) }
    })
  }, [index, total])

  useEffect(() => () => cancelAnimationFrame(momentumFrame.current), [])

  const stripPointerDown = (event) => {
    const strip = stripRef.current
    if (!strip) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancelAnimationFrame(momentumFrame.current)
    stripDrag.current = {
      active: true,
      startX: event.clientX,
      startLeft: strip.scrollLeft,
      moved: false,
      pointerId: event.pointerId,
      velocity: 0,
      lastX: event.clientX,
      lastAt: performance.now()
    }
  }

  const stripPointerMove = (event) => {
    const state = stripDrag.current
    const strip = stripRef.current
    if (!state.active || !strip) return
    const dx = event.clientX - state.startX
    if (!state.moved && Math.abs(dx) > 4) {
      state.moved = true
      // Sürükleme başladığında pointer'ı yakala; böylece şeritten çıkınca da takip eder.
      try {
        strip.setPointerCapture(state.pointerId ?? event.pointerId)
      } catch {
        /* sentetik olaylarda pointer yakalanamayabilir */
      }
    }
    if (!state.moved) return
    const now = performance.now()
    const deltaX = event.clientX - state.lastX
    const deltaT = Math.max(1, now - state.lastAt)
    state.velocity = (deltaX / deltaT) * 16
    state.lastX = event.clientX
    state.lastAt = now
    strip.scrollLeft = state.startLeft - dx
    event.preventDefault()
  }

  const stripPointerEnd = (event) => {
    const state = stripDrag.current
    if (!state.active) return
    state.active = false
    if (state.moved) {
      // Sürükleme bittiğinde oluşan tıklamayı yut ki fotoğraf atlanmasın.
      skipStripClick.current = true
      window.setTimeout(() => {
        skipStripClick.current = false
      }, 0)

      // Sürükleme momentumu
      const strip = stripRef.current
      let velocity = state.velocity
      if (strip) {
        const glide = () => {
          if (Math.abs(velocity) < 0.35) return
          strip.scrollLeft -= velocity
          velocity *= 0.92
          momentumFrame.current = requestAnimationFrame(glide)
        }
        momentumFrame.current = requestAnimationFrame(glide)
      }
    }
    try {
      stripRef.current?.releasePointerCapture(state.pointerId ?? event.pointerId)
    } catch {
      /* ignore */
    }
  }

  const stripWheel = (event) => {
    const strip = stripRef.current
    if (!strip) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    strip.scrollLeft += event.deltaY
    event.preventDefault()
  }

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [])

  // Ses değişikliklerini hem arka videoya hem ayarlara uygular.
  // Tam ekrandaki oynatıcı da aynı değerleri kullanır.
  const applyAudio = useCallback(
    (next) => {
      const video = videoRef.current
      if (typeof next.volume === 'number') {
        const value = Math.max(0, Math.min(1, next.volume))
        setVolume(value)
        if (video) video.volume = value
      }
      if (typeof next.muted === 'boolean') {
        setMuted(next.muted)
        if (video) video.muted = next.muted
      }
      clearTimeout(audioTimer.current)
      audioTimer.current = window.setTimeout(() => onAudioChange?.(next), 180)
    },
    [onAudioChange]
  )

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    const nextMuted = video ? !video.muted : !muted
    const patch = { muted: nextMuted }
    if (!nextMuted && volume === 0) patch.volume = 1
    applyAudio(patch)
  }, [applyAudio, muted, volume])

  const changeVolume = useCallback(
    (value) => {
      const next = Math.max(0, Math.min(1, value))
      applyAudio({ volume: next, muted: next === 0 })
    },
    [applyAudio]
  )

  const nudge = useCallback((seconds) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + seconds))
  }, [])

  const changeRate = useCallback((value) => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = value
    setRate(value)
  }, [])

  const seekTo = useCallback(
    (event) => {
      const video = videoRef.current
      if (!video || !duration) return
      const next = (Number(event.target.value) / 1000) * duration
      video.currentTime = next
      setProgress(next)
    },
    [duration]
  )

  const verdicts = useMemo(() => {
    const marks = review?.marks || {}
    const values = Object.values(marks)
    return {
      kept: values.filter((value) => value === 'keep').length,
      deleted: values.filter((value) => value === 'delete').length,
      skipped: values.filter((value) => value === 'skip').length
    }
  }, [review])

  // İlerleme barı konumu değil, karar verilen (tut / sil / atla) öğeleri sayar.
  const decided = useMemo(() => {
    const marks = review?.marks || {}
    let count = 0
    for (const entry of review?.items || []) {
      if (marks[entry.path]) count += 1
    }
    return count
  }, [review])

  const deletions = useMemo(() => (review ? review.items.filter((entry) => review.marks[entry.path] === 'delete') : []), [review])
  const freedBytes = deletions.reduce((sum, entry) => sum + entry.size, 0)
  const remainingBytes = useMemo(() => (review ? review.items.slice(index).reduce((sum, entry) => sum + entry.size, 0) : 0), [review, index])
  const selectedDeletions = useMemo(
    () => deletions.filter((entry) => pauseSelection.has(entry.path)),
    [deletions, pauseSelection]
  )
  const selectedBytes = selectedDeletions.reduce((sum, entry) => sum + entry.size, 0)

  const commit = useCallback(
    async (verdict) => {
      if (!review || flying || finished || pauseOpen) return
      if (verdict === 'keep' || verdict === 'delete') playSound(verdict)
      setFlying(true)
      const direction = verdict === 'delete' ? (leftDelete ? -1 : 1) : verdict === 'keep' ? (leftDelete ? 1 : -1) : 0
      if (fullscreen) {
        await animate(opacity, 0, { duration: 0.1 })
      } else if (direction === 0) {
        await animate(opacity, 0, { duration: 0.16 })
      } else {
        await animate(x, direction * 780, { duration: 0.26, ease: [0.3, 0, 0.7, 1] })
      }
      onMark(verdict)
      x.set(0)
      opacity.set(1)
      setFlying(false)
    },
    [review, flying, finished, leftDelete, onMark, x, opacity, fullscreen, pauseOpen]
  )

  const requestPause = useCallback(() => {
    if (!review || busy) return
    if (!deletions.length) {
      onPause()
      return
    }
    setPauseSelection(new Set(deletions.map((entry) => entry.path)))
    setPauseOpen(true)
  }, [review, busy, deletions, onPause])

  const closePause = useCallback(() => setPauseOpen(false), [])

  const togglePauseItem = useCallback((path) => {
    setPauseSelection((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const confirmPause = useCallback(
    (mode) => {
      if (!selectedDeletions.length) return
      setPauseOpen(false)
      onPause({ mode, paths: selectedDeletions.map((entry) => entry.path) })
    },
    [selectedDeletions, onPause]
  )

  const pauseLater = useCallback(() => {
    setPauseOpen(false)
    onPause({ paths: [] })
  }, [onPause])

  const requestDiscard = useCallback(() => {
    onConfirm({
      title: t('review.cancel'),
      body: t('review.cancelConfirm'),
      danger: true,
      confirmLabel: t('review.cancel'),
      onConfirm: onDiscard
    })
  }, [onConfirm, onDiscard, t])

  useEffect(() => {
    const handler = (event) => {
      const target = event.target
      const tag = target?.tagName
      const textInput = tag === 'INPUT' && !['range', 'button', 'checkbox', 'radio', 'file'].includes(target?.type)
      if (tag === 'TEXTAREA' || textInput) return
      if (done) return
      if (!review) return
      if (pauseOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setPauseOpen(false)
        }
        return
      }
      if (infoOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setInfoOpen(false)
        }
        return
      }

      // Medya kontrolüne tıklandığında odak orada kalıyordu; ilk kısayolda
      // odağı bırak ki f / ← / → gibi tuşlar hemen çalışsın.
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') target.blur?.()

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!finished) requestPause()
        return
      }
      if (event.key === 'f' || event.key === 'F') {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault()
        if (!finished) setFullscreen((value) => !value)
      } else if (event.key === 'ArrowLeft') {
        if (fullscreen) return
        event.preventDefault()
        if (!finished) commit(leftVerdict)
      } else if (event.key === 'ArrowRight') {
        if (fullscreen) return
        event.preventDefault()
        if (!finished) commit(rightVerdict)
      } else if (event.code === 'Space') {
        if (fullscreen) return
        event.preventDefault()
        if (!finished) commit('skip')
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (!flying) onUndo()
      } else if (event.key === 'Escape') {
        if (fullscreen) setFullscreen(false)
        else if (finished) requestDiscard()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commit, leftVerdict, rightVerdict, finished, busy, onApply, onUndo, review, done, requestDiscard, requestPause, flying, fullscreen, pauseOpen, infoOpen])

  useEffect(() => {
    if (finished) setFullscreen(false)
  }, [finished])

  /* ---------- done summary ---------- */

  if (done) {
    const session = done.session
    return (
      <div className="review-screen">
        <div className="center-wrap">
          <motion.div
            className="summary-card done-card"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            <div className="done-mark">
              <Icon name="check" size={38} strokeWidth={2.4} />
            </div>
            <div className="done-title">{done.paused ? t('review.summaryTitle') : t('review.doneTitle')}</div>
            <div className="page-sub center">{done.paused ? t('review.pausedSub') : t('review.doneSub')}</div>
            <div className="done-freed">{formatBytes(session.bytes, lang)}</div>
            <div className="done-freed-label">{t('review.doneFreed')}</div>
            <div className="done-chips">
              <span className="badge olive">
                <Icon name="check" size={12} /> {session.kept.toLocaleString(locale)} {t('review.kept')}
              </span>
              <span className="badge">
                <Icon name="trash" size={12} /> {session.deleted.toLocaleString(locale)} {t('review.deletedPast')}
              </span>
              <span className="badge">
                <Icon name="arrowRight" size={12} /> {session.skipped.toLocaleString(locale)} {t('review.skipped')}
              </span>
            </div>
            {done.remaining > 0 && <div className="done-note">{t('review.doneRemaining', { n: done.remaining.toLocaleString(locale) })}</div>}
            {done.remaining === 0 && done.paused && <div className="done-note">{t('review.doneComplete')}</div>}
            {done.failed > 0 && <div className="done-warn">{t('review.toastFail', { n: done.failed })}</div>}
            <div className="done-actions">
              {done.resume ? (
                <button className="btn btn-primary" onClick={onResume} disabled={busy}>
                  <Icon name="play" size={15} filled />
                  {t('review.doneResume')}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={onNewSession} disabled={busy}>
                  <Icon name="sparkle" size={16} />
                  {t('review.doneAgain')}
                </button>
              )}
              <button className="btn btn-ghost" onClick={onHome} disabled={busy}>
                {t('review.doneHome')}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    )
  }

  if (!review) {
    return (
      <div className="review-screen">
        <Empty
          icon="sparkle"
          title={t('review.empty')}
          sub={t('review.emptyHint')}
          action={
            <button className="btn btn-primary" onClick={onHome}>
              {t('review.doneHome')}
            </button>
          }
        />
      </div>
    )
  }

  if (finished) {
    return (
      <div className="review-screen">
        <div className="center-wrap">
          <motion.div className="summary-card" initial={{ opacity: 0, scale: 0.97, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
            <div className="summary-title">{t('review.summaryTitle')}</div>
            <div className="page-sub">{t('review.summarySub')}</div>
            <div className="summary-grid">
              <div className="summary-tile keep">
                <div className="v">{verdicts.kept.toLocaleString(locale)}</div>
                <div className="l">{t('review.kept')}</div>
              </div>
              <div className="summary-tile drop">
                <div className="v">{verdicts.deleted.toLocaleString(locale)}</div>
                <div className="l">{t('review.deleted')}</div>
              </div>
              <div className="summary-tile">
                <div className="v">{verdicts.skipped.toLocaleString(locale)}</div>
                <div className="l">{t('review.skipped')}</div>
              </div>
              <div className="summary-tile freed">
                <div className="v">{formatBytes(freedBytes, lang)}</div>
                <div className="l">{t('review.freed')}</div>
              </div>
            </div>
            <div className="summary-actions">
              {deletions.length ? (
                <button className="btn btn-danger btn-lg" onClick={onApply} disabled={busy}>
                  {busy ? <span className="spinner" /> : <Icon name={settings.deleteMode === 'trash' ? 'trash' : 'x'} size={17} />}
                  {settings.deleteMode === 'trash' ? t('review.applyTrash', { n: deletions.length }) : t('review.applyPermanent', { n: deletions.length })}
                </button>
              ) : (
                <button className="btn btn-success btn-lg" onClick={onApply} disabled={busy}>
                  <Icon name="check" size={17} />
                  {t('review.applyKeepHint')}
                </button>
              )}
              <button className="btn btn-ghost" onClick={requestDiscard}>
                {t('review.cancel')}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    )
  }

  const isVideo = item?.kind === 'video'
  const mediaUrl = window.api.mediaUrl(item.path)
  const externalVideo = isVideo && needsExternalPlayer(item)

  return (
    <div className="review-screen">
      <div className="review-top">
        <button className="btn btn-ghost btn-icon" onClick={requestDiscard} title={t('review.cancel')}>
          <Icon name="x" size={17} />
        </button>
        <div className="review-progress">
          <motion.div
            className="bar"
            initial={{ width: '0%' }}
            animate={{ width: `${percent(decided, total)}%` }}
            transition={{ type: 'spring', stiffness: 260, damping: 32 }}
          />
        </div>
        <div className="review-counter">
          {t('review.counter', { i: index + 1, n: total })} · {formatBytes(remainingBytes, lang)}
        </div>
        <button
          className={`btn btn-ghost btn-icon ${selecting ? 'active' : ''}`}
          onClick={() => {
            setSelecting((prev) => !prev)
            setBulkSel(new Set())
          }}
          title={t('review.bulkSelect')}
          aria-label={t('review.bulkSelect')}
        >
          <Icon name="check" size={16} />
        </button>
        <button className="btn btn-ghost btn-icon review-info-btn" onClick={() => setInfoOpen(true)} title={t('review.info')} aria-label={t('review.info')}>
          <Icon name="info" size={16} />
        </button>
        <select
          className="review-sort"
          value={review?.sort || 'session'}
          onChange={(event) => onSort?.(event.target.value)}
          title={t('review.sort')}
          aria-label={t('review.sort')}
        >
          <option value="session">{t('review.sortSession')}</option>
          <option value="dateDesc">{t('review.sortDateDesc')}</option>
          <option value="dateAsc">{t('review.sortDateAsc')}</option>
          <option value="sizeDesc">{t('review.sortSizeDesc')}</option>
          <option value="sizeAsc">{t('review.sortSizeAsc')}</option>
        </select>
        <button className="btn btn-sm pause-btn" onClick={requestPause} disabled={busy} title={`${t('review.pause')} · Ctrl+Enter`}>
          <Icon name="arrowRight" size={14} />
          {t('review.pause')}
          {deletions.length > 0 && <span className="apply-count">{deletions.length}</span>}
        </button>
      </div>

      {selecting && (
        <div className="bulk-bar">
          <span className="bulk-count">{t('review.bulkSelected', { n: bulkSel.size, total })}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setBulkSel(new Set(review.items.map((entry) => entry.path)))}
          >
            {t('review.bulkAll')}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={!bulkSel.size} onClick={() => setBulkSel(new Set())}>
            {t('common.clear')}
          </button>
          <div className="bulk-actions">
            <button
              className="btn btn-sm bulk-keep"
              disabled={!bulkSel.size || busy}
              onClick={() => {
                onBulkMark?.([...bulkSel], 'keep')
                setSelecting(false)
                setBulkSel(new Set())
              }}
            >
              <Icon name="check" size={14} />
              {t('review.bulkKeep')}
            </button>
            <button
              className="btn btn-sm bulk-delete"
              disabled={!bulkSel.size || busy}
              onClick={() => {
                // Toplu sil seçimi doğrudan silmez; silme özette/uygulamada onaylanır.
                onBulkMark?.([...bulkSel], 'delete')
                setSelecting(false)
                setBulkSel(new Set())
              }}
            >
              <Icon name="x" size={14} />
              {t('review.bulkDelete')}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSelecting(false)
                setBulkSel(new Set())
              }}
            >
              {t('review.bulkCancel')}
            </button>
          </div>
        </div>
      )}

      <div className="review-strip">
        <div
          className="review-strip-track"
          ref={stripRef}
          onPointerDown={stripPointerDown}
          onPointerMove={stripPointerMove}
          onPointerUp={stripPointerEnd}
          onPointerCancel={stripPointerEnd}
          onWheel={stripWheel}
          onScroll={syncStripWindow}
          onClickCapture={(event) => {
            if (!skipStripClick.current) return
            skipStripClick.current = false
            event.preventDefault()
            event.stopPropagation()
          }}
          onDragStart={(event) => event.preventDefault()}
        >
          {stripWindow.start > 0 && (
            <div className="strip-spacer" style={{ width: stripWindow.start * STRIP_STEP - 8 }} aria-hidden="true" />
          )}
          {review.items.slice(stripWindow.start, stripWindow.end).map((entry, offset) => {
            const stripIndex = stripWindow.start + offset
            const mark = review.marks?.[entry.path]
            const isCurrent = stripIndex === index
            const isPicked = selecting && bulkSel.has(entry.path)
            return (
              <button
                key={entry.path}
                type="button"
                className={`strip-thumb ${isCurrent ? 'current' : ''} ${mark || ''} ${isPicked ? 'picked' : ''}`}
                onClick={() => {
                  if (selecting) {
                    setBulkSel((prev) => {
                      const next = new Set(prev)
                      if (next.has(entry.path)) next.delete(entry.path)
                      else next.add(entry.path)
                      return next
                    })
                    return
                  }
                  onJump(stripIndex)
                }}
                title={`${stripIndex + 1} / ${total} · ${entry.name}`}
              >
                <Thumb item={entry} size={96} className="strip-thumb-media" videoFallback lazy />
                {mark ? (
                  <span className={`strip-mark ${mark}`}>
                    {mark === 'skip' ? <span className="strip-skip">–</span> : <Icon name={mark === 'delete' ? 'x' : 'check'} size={9} strokeWidth={3.2} />}
                  </span>
                ) : null}
              </button>
            )
          })}
          {stripWindow.end < total && (
            <div className="strip-spacer" style={{ width: (total - stripWindow.end) * STRIP_STEP - 8 }} aria-hidden="true" />
          )}
        </div>
      </div>

      <div className="stage">
        {!isVideo && (
          <motion.div
            key={`ambient-${item.path}`}
            className="stage-ambient"
            style={{ backgroundImage: `url("${mediaUrl}")` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ duration: 0.5 }}
          />
        )}

        <motion.div
          className="stage-card"
          drag="x"
          dragControls={dragControls}
          dragListener={false}
          dragElastic={0.72}
          dragConstraints={{ left: 0, right: 0 }}
          onPointerDown={(event) => {
            // Oynatıcı kontrol çubuğu / kaydırıcı üzerinde sürükleme başlamasın;
            // yoksa ileri sararken medya yanlışlıkla "tut" olarak işaretleniyor.
            if (event.pointerType === 'mouse' && event.button !== 0) return
            if (event.target?.closest?.('input, select, button, .video-controls')) return
            dragControls.start(event)
          }}
          onDragEnd={(_event, info) => {
            const offset = info.offset.x
            const velocity = info.velocity.x
            if (offset < -100 || velocity < -650) commit(leftVerdict)
            else if (offset > 100 || velocity > 650) commit(rightVerdict)
          }}
          style={{ x, rotate, opacity }}
          whileTap={{ scale: 0.995 }}
        >
          {isVideo ? (
            externalVideo || videoFailed ? (
              <MediaFallback item={item} onOpen={() => window.api.openFile(item.path)} />
            ) : (
            <div className="stage-video">
              <video
                ref={videoRef}
                src={mediaUrl}
                autoPlay={!fullscreen}
                muted={muted}
                loop
                playsInline
                onError={() => setVideoFailed(true)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => {
                  setDuration(event.currentTarget.duration)
                  event.currentTarget.playbackRate = rate
                  event.currentTarget.volume = volume
                  if (!fullscreen) event.currentTarget.play().catch(() => {})
                }}
              />
              <div className="video-controls" onPointerDown={(event) => event.stopPropagation()}>
                <button type="button" className="vc-btn" onClick={togglePlay} title={playing ? t('video.pause') : t('video.play')}>
                  <Icon name={playing ? 'pause' : 'play'} size={13} filled />
                </button>
                <button type="button" className="vc-btn vc-text" onClick={() => nudge(-5)} title={t('video.back5')}>
                  −5s
                </button>
                <span className="vc-time">
                  {clock(progress)} / {clock(duration)}
                </span>
                <input
                  type="range"
                  className="vc-seek"
                  min="0"
                  max="1000"
                  step="1"
                  value={duration ? Math.round((progress / duration) * 1000) : 0}
                  onChange={seekTo}
                  style={{ '--fill': `${duration ? Math.min(100, (progress / duration) * 100) : 0}%` }}
                  aria-label={t('video.seek')}
                />
                <button type="button" className="vc-btn vc-text" onClick={() => nudge(5)} title={t('video.forward5')}>
                  +5s
                </button>
                <select
                  className="vc-rate"
                  value={rate}
                  onChange={(event) => changeRate(Number(event.target.value))}
                  title={t('video.speed')}
                  aria-label={t('video.speed')}
                >
                  {SPEEDS.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}×
                    </option>
                  ))}
                </select>
                <span className="vc-volume" title={t('video.volume')}>
                  <Icon name={volume > 0 && !muted ? 'volume' : 'volumeOff'} size={13} />
                  <input
                    type="range"
                    className="vc-seek vc-vol"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(volume * 100)}
                    onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                    style={{ '--fill': `${Math.round(volume * 100)}%` }}
                    aria-label={t('video.volume')}
                  />
                </span>
                <button type="button" className="vc-btn" onClick={toggleMute} title={muted ? t('video.unmute') : t('video.mute')}>
                  <Icon name={muted ? 'volumeOff' : 'volume'} size={14} />
                </button>
                <button type="button" className="vc-btn" onClick={() => window.api.openFile(item.path)} title={t('video.openExternal')}>
                  <Icon name="external" size={13} />
                </button>
              </div>
            </div>
            )
          ) : shellImage || imageFailed ? (
            <MediaFallback item={item} poster={shellThumb} onOpen={() => window.api.openFile(item.path)} />
          ) : (
            <img src={mediaUrl} draggable={false} alt={item.name} onError={() => setImageFailed(true)} />
          )}

          <motion.div className="swipe-tint keep" style={{ opacity: leftVerdict === 'keep' ? leftOpacity : rightOpacity }}>
            <span>{t('review.keep')}</span>
          </motion.div>
          <motion.div className="swipe-tint drop" style={{ opacity: leftVerdict === 'delete' ? leftOpacity : rightOpacity }}>
            <span>{t('review.delete')}</span>
          </motion.div>
        </motion.div>
      </div>

      <div className="review-info">
        <div className="review-info-name" title={item.name}>
          {item.name}
        </div>
        <div className="review-info-facts">
          <span>{formatBytes(item.size, lang)}</span>
          <span>{relativeTime(item.takenAt, locale)}</span>
          <span>{t(`media.${item.ext === '.gif' ? 'gif' : item.kind}`)}</span>
        </div>
      </div>

      <div className="review-actions">
        <button className="round-btn small" onClick={onUndo} title={t('review.undo')} disabled={index === 0}>
          <Icon name="undo" size={17} />
        </button>
        <button className={`round-btn ${leftVerdict === 'delete' ? 'delete' : 'keep'}`} onClick={() => commit(leftVerdict)} title={t(`review.${leftVerdict}`)}>
          <Icon name={leftVerdict === 'delete' ? 'x' : 'check'} size={23} strokeWidth={2.4} />
        </button>
        <button className="round-btn small" onClick={() => commit('skip')} title={t('review.skip')}>
          <Icon name="arrowRight" size={17} />
        </button>
        <button className={`round-btn ${rightVerdict === 'delete' ? 'delete' : 'keep'}`} onClick={() => commit(rightVerdict)} title={t(`review.${rightVerdict}`)}>
          <Icon name={rightVerdict === 'delete' ? 'x' : 'check'} size={23} strokeWidth={2.4} />
        </button>
        <button className="round-btn small ghost" onClick={() => setFullscreen(true)} title={`${t('review.fullscreen')} · F`}>
          <Icon name="expand" size={17} />
        </button>
      </div>

      <div className="review-hint">
        <span className="keycap">
          <Icon name="arrowLeft" size={12} />
        </span>
        {leftVerdict === 'delete' ? t('review.swipeDelete') : t('review.swipeKeepLeft')}
        <span className="dot-sep">·</span>
        <span className="keycap">
          <Icon name="arrowRight" size={12} />
        </span>
        {rightVerdict === 'delete' ? t('review.swipeDeleteRight') : t('review.swipeKeep')}
        <span className="dot-sep">·</span>
        <span className="keycap wide">Space</span>
        {t('review.skip')}
        <span className="dot-sep">·</span>
        <span className="keycap">F</span>
        {t('review.fullscreen').toLocaleLowerCase(locale)}
      </div>

      <AnimatePresence>
        {fullscreen && (
          <FullscreenViewer
            item={item}
            volume={volume}
            muted={muted}
            onAudioChange={applyAudio}
            onClose={() => setFullscreen(false)}
            onPrev={() => onJump(Math.max(0, index - 1))}
            onNext={() => onJump(Math.min(Math.max(0, total - 1), index + 1))}
            onKeep={() => commit('keep')}
            onDelete={() => commit('delete')}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{infoOpen && <MediaInfoModal item={item} onClose={() => setInfoOpen(false)} />}</AnimatePresence>

      <AnimatePresence>
        {pauseOpen ? (
          <motion.div className="modal-backdrop pause-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closePause}>
            <motion.div
              className="pause-modal"
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ type: 'spring', stiffness: 330, damping: 28 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="pause-head">
                <div className="pause-icon">
                  <Icon name="trash" size={20} />
                </div>
                <div>
                  <div className="modal-title">{t('review.pauseTitle', { n: deletions.length.toLocaleString(locale) })}</div>
                  <div className="modal-body">{t('review.pauseSub')}</div>
                </div>
              </div>

              <div className="pause-selectbar">
                <span className="badge">{t('review.pauseSelected', { n: selectedDeletions.length.toLocaleString(locale) })}</span>
                <span className="muted tiny">{formatBytes(selectedBytes, lang)}</span>
                <div className="toolbar-spacer" />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPauseSelection(new Set(deletions.map((entry) => entry.path)))}>
                  {t('select.all')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPauseSelection(new Set())}>
                  {t('select.none')}
                </button>
              </div>

              <div className="pause-grid">
                {deletions.map((entry) => {
                  const checked = pauseSelection.has(entry.path)
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      className={`pause-tile ${checked ? 'checked' : ''}`}
                      onClick={() => togglePauseItem(entry.path)}
                    >
                      <Thumb item={entry} size={200} className="pause-thumb" videoFallback lazy />
                      <span className="pause-check">
                        {checked ? <Icon name="check" size={12} strokeWidth={3.2} /> : null}
                      </span>
                      <span className="pause-name" title={entry.name}>
                        {entry.name}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="pause-actions">
                <button type="button" className="btn btn-ghost" onClick={pauseLater}>
                  {t('review.pauseLater')}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => confirmPause('trash')} disabled={!selectedDeletions.length}>
                  <Icon name="trash" size={15} />
                  {t('review.pauseTrash')}
                </button>
                <button type="button" className="btn btn-danger" onClick={() => confirmPause('permanent')} disabled={!selectedDeletions.length}>
                  <Icon name="x" size={15} />
                  {t('review.pausePermanent')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
