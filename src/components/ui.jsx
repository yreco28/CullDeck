import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './Icon'
import { useI18n } from '../i18n'
import { formatBytes } from '../lib/format'
import { needsExternalPlayer, needsShellPreview } from '../lib/mediaSupport'

export function TitleBar({ folder }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.win.isMaximized().then(setMaximized)
    return window.api.win.onMaximized(setMaximized)
  }, [])

  return (
    <div className="titlebar" onDoubleClick={() => window.api.win.toggleMaximize()}>
      <div className="brand">
        <span className="brand-mark">
          <CullDeckMark size={22} />
        </span>
        <span>CullDeck</span>
      </div>
      <div className="titlebar-spacer" />
      {folder && (
        <div className="titlebar-folder" title={folder}>
          <Icon name="folder" size={13} />
          <span>{folder}</span>
        </div>
      )}
      <div className="titlebar-actions">
        <button className="win-btn" onClick={() => window.api.win.minimize()} title="Küçült">
          <Icon name="minimize" size={15} />
        </button>
        <button className="win-btn" onClick={() => window.api.win.toggleMaximize()} title={maximized ? 'Geri yükle' : 'Büyüt'}>
          <Icon name={maximized ? 'restore' : 'maximize'} size={13} />
        </button>
        <button className="win-btn close" onClick={() => window.api.win.close()} title="Kapat">
          <Icon name="x" size={15} />
        </button>
      </div>
    </div>
  )
}

export function CullDeckMark({ size = 22 }) {
  return <img src="./icon-small.svg" width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}

export function HeroArt() {
  return <img src="./hero-art.svg" width="180" height="180" alt="" aria-hidden="true" draggable={false} />
}

export function Sidebar({ route, onNavigate, items, sizeLabel, t, review }) {
  const nav = [
    { key: 'home', icon: 'wand', label: t('nav.home') },
    { key: 'gallery', icon: 'grid', label: t('nav.gallery') },
    { key: 'stats', icon: 'chart', label: t('nav.stats') },
    { key: 'settings', icon: 'gear', label: t('nav.settings') }
  ]

  return (
    <aside className="sidebar">
      <div className="sidebar-title">{t('nav.menu')}</div>

      {review && review.items?.length ? (
        <button className={`nav-item ${route === 'review' ? 'active' : ''}`} onClick={() => onNavigate('review')}>
          {route === 'review' && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <Icon name="sparkle" size={18} />
          <span className="nav-label">{t('nav.resume')}</span>
          <span className="nav-dot" />
        </button>
      ) : null}

      <nav className="nav">
        {nav.map((entry) => (
          <button key={entry.key} className={`nav-item ${route === entry.key ? 'active' : ''}`} onClick={() => onNavigate(entry.key)}>
            {route === entry.key && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <Icon name={entry.icon} size={18} />
            <span className="nav-label">{entry.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="side-card">
          <div className="side-card-head">
            <Icon name="database" size={13} />
            <span>{t('gallery.title')}</span>
          </div>
          <div className="side-card-value">{items ? items.toLocaleString('tr-TR') : '0'}</div>
          <div className="side-card-sub">{sizeLabel}</div>
          <div className="side-meter">
            <div style={{ width: `${Math.min(100, ((items || 0) / 40) * 100)}%` }} />
          </div>
        </div>
      </div>
    </aside>
  )
}

export function Thumb({ item, size = 512, className = '', alt = '', videoFallback = false, lazy = false }) {
  const holder = useRef(null)
  const [visible, setVisible] = useState(() => !lazy)
  const [url, setUrl] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // Lazy loading (F1): küçük resim ancak görünür alana yaklaşınca üretilir.
  // Binlerce öğeli oturumlarda tüm thumbnail'ların aynı anda istenmesini engeller.
  useEffect(() => {
    if (!lazy) {
      setVisible(true)
      return undefined
    }
    if (visible) return undefined
    const node = holder.current
    if (!node) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '420px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [lazy, visible, item?.path])

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    setUrl(null)
    setLoaded(false)
    setFailed(false)
    if (!item?.path) return undefined
    window.api
      .thumb(item.path, size)
      .then((result) => {
        if (!alive) return
        if (result) setUrl(result)
        else setFailed(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [item?.path, size, visible])

  if (failed) {
    if (videoFallback && item?.kind === 'video') {
      return <video className={className} src={`${window.api.mediaUrl(item.path)}#t=0.2`} muted preload="metadata" />
    }
    return (
      <div className={`${className} thumb-fallback`}>
        <Icon name={item?.kind === 'video' ? 'video' : 'image'} size={22} />
      </div>
    )
  }

  if (!url) return <div ref={holder} className={`${className} skeleton`} />

  return <img className={`${className} fade-img ${loaded ? 'loaded' : ''}`} src={url} alt={alt} draggable={false} loading="lazy" onLoad={() => setLoaded(true)} />
}

/**
 * Chromium'un çözemediği medya için kart: kısa açıklama + harici uygulama.
 * `poster` verilirse (Windows önizlemesi) küçük bir görsel de gösterilir.
 */
export function MediaFallback({ item, poster, onOpen, fullscreen = false }) {
  const { t } = useI18n()
  const isVideo = item?.kind === 'video'
  return (
    <div className={`media-fallback ${fullscreen ? 'is-fullscreen' : ''}`}>
      {poster ? (
        <img className="media-fallback-poster" src={poster} alt={item?.name || ''} draggable={false} />
      ) : (
        <span className="media-fallback-icon">
          <Icon name={isVideo ? 'video' : 'image'} size={26} />
        </span>
      )}
      <div className="media-fallback-body">
        <strong>{t(isVideo ? 'media.videoTitle' : 'media.imageTitle')}</strong>
        <span>{t(isVideo ? 'media.videoHint' : poster ? 'media.imageHintPreview' : 'media.imageHint')}</span>
      </div>
      <button type="button" className="btn btn-sm btn-primary media-fallback-btn" onPointerDown={(event) => event.stopPropagation()} onClick={onOpen}>
        <Icon name="external" size={13} />
        {t('media.openExternal')}
      </button>
    </div>
  )
}

export function Toasts({ toasts }) {
  return (
    <div className="toast-wrap">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className={`toast ${toast.type || ''}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          >
            <Icon name={toast.type === 'error' ? 'info' : 'check'} size={15} />
            <span>{toast.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Empty({ icon = 'image', title, sub, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
      {action}
    </div>
  )
}

export function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.value} className={value === option.value ? 'on' : ''} onClick={() => onChange(option.value)}>
          {option.icon && <Icon name={option.icon} size={13} />}
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-label={label} aria-pressed={on}>
      <motion.div layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  )
}

export function ZoomLayer({ item, onClose, onPrev, onNext }) {
  const ref = useRef(null)
  const { t } = useI18n()

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && onPrev) onPrev()
      else if (event.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, onPrev, onNext])

  if (!item) return null
  return createPortal(
    <motion.div className="zoom-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <div className="zoom-bar" onClick={(event) => event.stopPropagation()}>
        <button className="btn btn-sm zoom-btn" onClick={() => window.api.reveal(item.path)}>
          <Icon name="folder" size={13} />
          {t('gallery.reveal')}
        </button>
        <div className="zoom-nav">
          <button className="btn btn-sm zoom-btn btn-icon" onClick={onPrev} disabled={!onPrev} title={t('common.previous')}>
            <Icon name="arrowLeft" size={15} />
          </button>
          <button className="btn btn-sm zoom-btn btn-icon" onClick={onNext} disabled={!onNext} title={t('common.next')}>
            <Icon name="arrowRight" size={15} />
          </button>
        </div>
        <button className="btn btn-sm zoom-btn btn-icon" onClick={onClose} title={t('common.close')}>
          <Icon name="x" size={15} />
        </button>
      </div>
      {item.kind === 'video' ? (
        <video ref={ref} src={window.api.mediaUrl(item.path)} controls autoPlay onClick={(e) => e.stopPropagation()} />
      ) : (
        <motion.img
          key={item.path}
          src={window.api.mediaUrl(item.path)}
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
        />
      )}
    </motion.div>,
    document.body
  )
}

export function FullscreenViewer({ item, onClose, onPrev, onNext, onKeep, onDelete, volume = 1, muted = false, onAudioChange }) {
  const { t, lang, locale } = useI18n()
  const layerRef = useRef(null)
  const videoRef = useRef(null)
  const dragRef = useRef(null)
  const [meta, setMeta] = useState(null)
  const [natural, setNatural] = useState(null)
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [failed, setFailed] = useState(false)
  const [shellThumb, setShellThumb] = useState(null)

  useEffect(() => {
    setScale(1)
    setPos({ x: 0, y: 0 })
    setMeta(null)
    setNatural(null)
    setFailed(false)
    setShellThumb(null)
  }, [item?.path])

  // Ses seviyesi normal ekranla ortaktır; tam ekranda da en son ayarla başlar.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = Math.max(0, Math.min(1, volume))
    video.muted = muted
  }, [volume, muted, item?.path])

  // Metadata is read on demand (A3) so opening a fullscreen view stays instant.
  useEffect(() => {
    if (!item?.path) return undefined
    let alive = true
    window.api
      .meta(item.path)
      .then((result) => {
        if (alive) setMeta(result)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [item?.path])

  // TIFF/HEIC gibi tarayıcının çözemediği görsellerde Windows önizlemesi.
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

  useEffect(() => {
    const node = layerRef.current
    if (!node) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      setScale((prev) => {
        const next = Math.min(6, Math.max(1, prev * (event.deltaY < 0 ? 1.18 : 1 / 1.18)))
        if (next === 1) setPos({ x: 0, y: 0 })
        return next
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [item?.path])

  // Tam ekranda gezinme ve karar kısayolları:
  // ← geri · → ileri · ↑ tut · ↓ sil
  useEffect(() => {
    const handler = (event) => {
      const target = event.target
      const tag = target?.tagName
      if (tag === 'TEXTAREA') return
      if (tag === 'INPUT' && target?.type !== 'range') return
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') target.blur?.()
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onPrev?.()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onNext?.()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        onKeep?.()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        onDelete?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onPrev, onNext, onKeep, onDelete])

  if (!item) return null

  const isVideo = item.kind === 'video'
  const externalVideo = isVideo && needsExternalPlayer(item)
  const toggleZoom = () => {
    if (scale > 1) {
      setScale(1)
      setPos({ x: 0, y: 0 })
    } else {
      setScale(2.4)
    }
  }

  const onPointerDown = (event) => {
    if (isVideo || scale <= 1) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { startX: event.clientX, startY: event.clientY, ox: pos.x, oy: pos.y }
    setDragging(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* synthetic events */
    }
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    setPos({ x: drag.ox + (event.clientX - drag.startX), y: drag.oy + (event.clientY - drag.startY) })
  }

  const onPointerUp = () => {
    dragRef.current = null
    setDragging(false)
  }

  const facts = []
  const width = meta?.width || natural?.width
  const height = meta?.height || natural?.height
  if (width && height) facts.push(`${width} × ${height}`)
  if (item.size) facts.push(formatBytes(item.size, lang))
  const camera = [meta?.make, meta?.model].filter(Boolean).join(' ')
  if (camera) facts.push(camera)
  if (meta?.lens) facts.push(meta.lens)
  if (meta?.iso) facts.push(`ISO ${meta.iso}`)
  if (meta?.fnumber) facts.push(`ƒ/${Math.round(meta.fnumber * 10) / 10}`)
  if (meta?.exposure) facts.push(meta.exposure < 1 ? `1/${Math.round(1 / meta.exposure)}s` : `${meta.exposure}s`)
  if (meta?.focal) facts.push(`${Math.round(meta.focal)} mm`)
  if (meta?.takenAt) facts.push(new Date(meta.takenAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }))

  return createPortal(
    <motion.div
      ref={layerRef}
      className="fs-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.div
        key={item.path}
        className={`fs-media ${scale > 1 ? 'zoomed' : ''} ${dragging ? 'dragging' : ''}`}
        initial={{ scale: 0.985, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={toggleZoom}
      >
        {isVideo ? (
          externalVideo || failed ? (
            <MediaFallback item={item} onOpen={() => window.api.openFile(item.path)} fullscreen />
          ) : (
            <video
              ref={videoRef}
              src={window.api.mediaUrl(item.path)}
              controls
              controlsList="nofullscreen"
              autoPlay
              loop
              playsInline
              onError={() => setFailed(true)}
              onVolumeChange={(event) =>
                onAudioChange?.({ volume: event.currentTarget.volume, muted: event.currentTarget.muted })
              }
              onClick={(event) => event.stopPropagation()}
            />
          )
        ) : shellImage || failed ? (
          <MediaFallback item={item} poster={shellThumb} onOpen={() => window.api.openFile(item.path)} fullscreen />
        ) : (
          <img
            src={window.api.mediaUrl(item.path)}
            alt={item.name}
            draggable={false}
            onError={() => setFailed(true)}
            onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${scale})` }}
          />
        )}
      </motion.div>

      <div className="fs-bar" onClick={(event) => event.stopPropagation()}>
        <div className="fs-name" title={item.name}>
          {item.name}
        </div>
        <button className="btn btn-sm zoom-btn btn-icon" onClick={() => window.api.openFile(item.path)} title={t('video.openExternal')}>
          <Icon name="external" size={14} />
        </button>
        <button className="btn btn-sm zoom-btn btn-icon" onClick={onClose} title={t('common.close')}>
          <Icon name="x" size={15} />
        </button>
      </div>

      {!isVideo && facts.length > 0 && (
        <div className="fs-meta" onClick={(event) => event.stopPropagation()}>
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </div>
      )}

      {!isVideo && (
        <div className="fs-zoom">
          <button className="btn btn-sm zoom-btn btn-icon" onClick={() => setScale((value) => Math.max(1, value / 1.25))} title="−">
            <Icon name="minimize" size={14} />
          </button>
          <span className="fs-zoom-value">{Math.round(scale * 100)}%</span>
          <button className="btn btn-sm zoom-btn btn-icon" onClick={() => setScale((value) => Math.min(6, value * 1.25))} title="+">
            <span className="plus">+</span>
          </button>
        </div>
      )}

      <div className="fs-hint">
        <span className="fs-hint-pair">
          <span className="keycap">←</span>
          {t('review.fsPrev')}
        </span>
        <span className="fs-hint-pair">
          <span className="keycap">→</span>
          {t('review.fsNext')}
        </span>
        <span className="fs-hint-pair">
          <span className="keycap">↑</span>
          {t('review.fsKeep')}
        </span>
        <span className="fs-hint-pair">
          <span className="keycap">↓</span>
          {t('review.fsDelete')}
        </span>
        <span className="dot-sep">·</span>
        <span className="keycap">F</span>
        <span className="keycap wide">Esc</span>
        {t('review.fullscreenHint')}
        {!isVideo && <span className="fs-hint-extra">{t('review.zoomHint')}</span>}
      </div>
    </motion.div>,
    document.body
  )
}

/* İnceleme ekranındaki "(i)" butonunun açtığı dosya bilgisi penceresi. */
export function MediaInfoModal({ item, onClose }) {
  const { t, lang, locale } = useI18n()
  const [meta, setMeta] = useState(null)
  const [natural, setNatural] = useState(null)

  useEffect(() => {
    setMeta(null)
    setNatural(null)
    if (!item?.path) return undefined
    let alive = true
    // Meta isteğe bağlı okunur; gelene kadar temel bilgiler gösterilir.
    window.api
      .meta(item.path)
      .then((result) => {
        if (alive) setMeta(result)
      })
      .catch(() => {})
    if (item.kind !== 'video') {
      const image = new Image()
      image.onload = () => {
        if (alive) setNatural({ width: image.naturalWidth, height: image.naturalHeight })
      }
      image.src = window.api.mediaUrl(item.path)
    }
    return () => {
      alive = false
    }
  }, [item?.path])

  if (!item) return null

  const width = meta?.width || natural?.width
  const height = meta?.height || natural?.height
  const takenAt = meta?.takenAt || item.takenAt
  const camera = [meta?.make, meta?.model].filter(Boolean).join(' ')
  const rows = [
    [t('review.infoName'), item.name],
    [t('review.infoSize'), item.size ? formatBytes(item.size, lang) : null],
    [t('review.infoDimensions'), width && height ? `${width} × ${height}` : null],
    [t('review.infoDate'), takenAt ? new Date(takenAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : null],
    [t('review.infoType'), t(`media.${item.ext === '.gif' ? 'gif' : item.kind}`)],
    [t('review.infoCamera'), camera || null],
    [t('review.infoLens'), meta?.lens || null],
    [t('review.infoIso'), meta?.iso ? String(meta.iso) : null],
    [t('review.infoAperture'), meta?.fnumber ? `ƒ/${Math.round(meta.fnumber * 10) / 10}` : null],
    [t('review.infoShutter'), meta?.exposure ? (meta.exposure < 1 ? `1/${Math.round(1 / meta.exposure)}s` : `${meta.exposure}s`) : null],
    [t('review.infoFocal'), meta?.focal ? `${Math.round(meta.focal)} mm` : null]
  ].filter(([, value]) => value)

  return createPortal(
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal info-modal"
        initial={{ opacity: 0, scale: 0.95, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-icon">
          <Icon name="info" size={22} />
        </div>
        <div className="modal-title info-title" title={item.path}>
          {t('review.info')}
        </div>
        <div className="info-rows">
          {rows.map(([label, value]) => (
            <div className="info-row" key={label}>
              <span className="info-label">{label}</span>
              <span className={`info-value${label === t('review.infoName') ? ' selectable' : ''}`}>{value}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  )
}
