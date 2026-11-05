import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Icon from '../components/Icon'
import { Empty, Thumb, ZoomLayer } from '../components/ui'
import { useI18n } from '../i18n'
import { formatBytes } from '../lib/format'
import { folderOf } from '../lib/session'

const TILE = { small: 118, medium: 156, large: 200 }

const norm = (value) => String(value || '').toLowerCase()

function sortItems(list, sort) {
  const copy = [...list]
  if (sort === 'old') copy.sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0))
  else if (sort === 'size') copy.sort((a, b) => (b.size || 0) - (a.size || 0))
  else if (sort === 'name') copy.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  else copy.sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0))
  return copy
}

export default function Gallery({ items, settings, busy, onBulk, onConfirm, onPick, onReview, totals, onOpenFolder }) {
  const { t, lang, locale } = useI18n()
  const [album, setAlbum] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [anchorPath, setAnchorPath] = useState(null)
  const [rangeBase, setRangeBase] = useState(null)
  const [zoomPath, setZoomPath] = useState(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('new')
  const [filter, setFilter] = useState('all')
  // Izgara sanallaştırması: yalnızca görünen satırlar (± tampon) render edilir.
  const screenRef = useRef(null)
  const gridRef = useRef(null)
  const gridRaf = useRef(0)
  const [gridWindow, setGridWindow] = useState({ start: 0, end: 80, top: 0, bottom: 0 })

  const albums = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      if (!map.has(item.album)) map.set(item.album, { name: item.album, items: [], bytes: 0 })
      const entry = map.get(item.album)
      entry.items.push(item)
      entry.bytes += item.size
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name))
  }, [items])

  const current = album ? albums.find((entry) => entry.name === album) : null
  // Açık albümün diskteki gerçek klasörü ("Klasörü Aç" düğmesi için).
  const albumFolder = current?.items?.length ? folderOf(current.items[0].path) : null
  // Arama Türkçe I→ı dönüşümü yüzünden "img" ile "IMG_" eşleşmiyordu (hata düzeltmesi).
  const q = norm(query.trim())
  const searching = q.length > 0
  const gridView = Boolean(album) || searching || filter !== 'all'
  const baseItems = current?.items || items

  const searched = useMemo(() => {
    if (!q) return baseItems
    return baseItems.filter((item) => norm(item.name).includes(q) || norm(item.album).includes(q) || norm(item.ext).includes(q))
  }, [baseItems, q])

  const filtered = useMemo(() => {
    if (filter === 'video') return searched.filter((item) => item.kind === 'video')
    if (filter === 'gif') return searched.filter((item) => item.ext === '.gif')
    if (filter === 'photo') return searched.filter((item) => item.kind === 'image' && item.ext !== '.gif')
    return searched
  }, [searched, filter])

  const visible = useMemo(() => sortItems(filtered, sort), [filtered, sort])

  // Görünür ızgara aralığını kaydırma konumundan ve gerçek sütun/satır
  // ölçülerinden hesapla. Boşluklar padding ile korunur; böylece kaydırma
  // çubuğu ve konum değişmez.
  const syncGridWindow = useCallback(() => {
    const screen = screenRef.current
    const grid = gridRef.current
    const count = visible.length
    if (!screen || !grid || !count) return
    const cs = getComputedStyle(grid)
    const cols = (cs.gridTemplateColumns || '').split(' ').filter(Boolean).length || 1
    const firstTile = grid.querySelector('.tile')
    const tileH = firstTile ? firstTile.offsetHeight : TILE[settings.gridSize] || TILE.medium
    const rowGap = parseFloat(cs.rowGap) || 8
    const rowH = tileH + rowGap
    const gridTop = grid.offsetTop
    const viewTop = Math.max(0, screen.scrollTop - gridTop)
    const bufferRows = 3
    const totalRows = Math.ceil(count / cols)
    const startRow = Math.min(Math.max(0, Math.floor(viewTop / rowH) - bufferRows), Math.max(0, totalRows - 1))
    const rowCount = Math.ceil(screen.clientHeight / rowH) + bufferRows * 2 + 1
    const start = Math.min(count - 1, startRow * cols)
    const end = Math.min(count, start + rowCount * cols)
    const endRow = Math.ceil(end / cols)
    const top = startRow * rowH
    const bottom = Math.max(0, (totalRows - endRow) * rowH)
    setGridWindow((prev) => (prev.start === start && prev.end === end && prev.top === top && prev.bottom === bottom ? prev : { start, end, top, bottom }))
  }, [visible.length, settings.gridSize])

  const onGridScroll = useCallback(() => {
    if (gridRaf.current) return
    gridRaf.current = requestAnimationFrame(() => {
      gridRaf.current = 0
      syncGridWindow()
    })
  }, [syncGridWindow])

  // Izgara, AnimatePresence "wait" modu nedeniyle efektlerden sonra
  // bağlanabildiği için ref bağlandığı anda pencereyi yeniden hesapla.
  const setGridRef = useCallback(
    (node) => {
      gridRef.current = node
      if (!node) return
      requestAnimationFrame(() => syncGridWindow())
    },
    [syncGridWindow]
  )

  useLayoutEffect(() => {
    syncGridWindow()
    window.addEventListener('resize', onGridScroll)
    return () => {
      window.removeEventListener('resize', onGridScroll)
      cancelAnimationFrame(gridRaf.current)
      gridRaf.current = 0
    }
  }, [syncGridWindow, onGridScroll, selecting, gridView, album, settings.gridSize])

  const visibleBytes = useMemo(() => visible.reduce((sum, item) => sum + item.size, 0), [visible])
  const selectedItems = visible.filter((item) => selected.has(item.path))
  const zoomIndex = zoomPath ? visible.findIndex((item) => item.path === zoomPath) : -1
  const zoomItem = zoomIndex >= 0 ? visible[zoomIndex] : null

  const toggle = (item) => {
    const next = new Set(selected)
    if (next.has(item.path)) next.delete(item.path)
    else next.add(item.path)
    setSelected(next)
    setAnchorPath(item.path)
    setRangeBase(null)
  }

  const selectRange = (target) => {
    const end = visible.findIndex((entry) => entry.path === target.path)
    if (end < 0) return
    const start = anchorPath ? visible.findIndex((entry) => entry.path === anchorPath) : -1
    if (start < 0) {
      const next = new Set(selected)
      next.add(target.path)
      setSelected(next)
      setAnchorPath(target.path)
      setRangeBase(null)
      return
    }
    const base = rangeBase || selected
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    const next = new Set(base)
    for (const entry of visible.slice(lo, hi + 1)) next.add(entry.path)
    setSelected(next)
    setRangeBase(base)
    // anchor stays fixed so every further Shift+click grows/shrinks from the first point
  }

  const allSelected = visible.length > 0 && visible.every((entry) => selected.has(entry.path))

  const selectAll = useCallback(() => {
    if (!visible.length) return
    setSelected(allSelected ? new Set() : new Set(visible.map((entry) => entry.path)))
    setAnchorPath(null)
    setRangeBase(null)
  }, [visible, allSelected])

  const leaveSelection = useCallback(() => {
    setSelecting(false)
    setSelected(new Set())
    setAnchorPath(null)
    setRangeBase(null)
  }, [])

  const clearSearch = useCallback(() => {
    setQuery('')
    if (!album) leaveSelection()
  }, [album, leaveSelection])

  const openAlbum = (name) => {
    setAlbum(name)
    leaveSelection()
  }

  const requestBulk = useCallback(
    (mode) => {
      if (!selectedItems.length || busy) return
      const trash = mode === 'trash'
      onConfirm({
        title: trash ? t('gallery.trash') : t('gallery.destroy'),
        body: trash ? t('gallery.confirmTrash', { n: selectedItems.length }) : t('gallery.confirmDestroy', { n: selectedItems.length }),
        icon: trash ? 'trash' : 'x',
        danger: !trash,
        confirmLabel: trash ? t('gallery.trash') : t('gallery.destroy'),
        onConfirm: async () => {
          await onBulk(selectedItems.map((item) => item.path), trash ? 'trash' : 'permanent')
          leaveSelection()
        }
      })
    },
    [selectedItems, busy, onConfirm, onBulk, leaveSelection, t]
  )

  const requestReview = useCallback(() => {
    if (!selectedItems.length || busy) return
    onReview(selectedItems)
    leaveSelection()
  }, [selectedItems, busy, onReview, leaveSelection])

  // B2: Ctrl+A tümünü seç, Esc seçimden çık, Delete çöp kutusuna taşı.
  useEffect(() => {
    const handler = (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        if (!gridView) return
        event.preventDefault()
        setSelecting(true)
        setSelected(new Set(visible.map((entry) => entry.path)))
        setAnchorPath(null)
        setRangeBase(null)
      } else if (event.key === 'Escape') {
        if (query) {
          event.preventDefault()
          clearSearch()
        } else if (selecting) {
          event.preventDefault()
          leaveSelection()
        }
      } else if (event.key === 'Delete' && selecting) {
        event.preventDefault()
        requestBulk('trash')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [gridView, visible, query, selecting, clearSearch, leaveSelection, requestBulk])

  if (!items.length) {
    return (
      <div className="screen" ref={screenRef} onScroll={onGridScroll}>
        <div className="screen-inner">
          <div className="screen-head">
            <div>
              <div className="page-title">{t('gallery.title')}</div>
              <div className="page-sub">{t('gallery.empty')}</div>
            </div>
            <button className="btn btn-primary" onClick={onPick}>
              <Icon name="folder" size={16} />
              {t('home.pick')}
            </button>
          </div>
          <Empty
            icon="grid"
            title={t('gallery.empty')}
            sub={t('gallery.emptyHint')}
            action={
              <button className="btn btn-primary" onClick={onPick}>
                <Icon name="folder" size={16} />
                {t('home.pick')}
              </button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="screen" ref={screenRef} onScroll={onGridScroll}>
      <div className="screen-inner">
        <div className="screen-head">
          <div className="head-left">
            {album && (
              <>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => {
                    setAlbum(null)
                    setQuery('')
                    leaveSelection()
                  }}
                  title={t('gallery.back')}
                >
                  <Icon name="arrowLeft" size={18} />
                </button>
                {albumFolder && (
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() => onOpenFolder?.(albumFolder)}
                    title={t('settings.openFolder')}
                    aria-label={t('settings.openFolder')}
                  >
                    <Icon name="external" size={16} />
                  </button>
                )}
              </>
            )}
            <div style={{ minWidth: 0 }}>
              <div className="page-title ellipsis">{album || t('gallery.title')}</div>
              <div className="page-sub">
                {gridView
                  ? `${searching ? t('gallery.results', { n: visible.length.toLocaleString(locale) }) : t('common.item', { n: visible.length.toLocaleString(locale) })} • ${formatBytes(
                      visibleBytes,
                      lang
                    )}`
                  : t('gallery.sub', { albums: albums.length, items: t('common.item', { n: items.length.toLocaleString(locale) }), size: formatBytes(totals.bytes, lang) })}
              </div>
            </div>
          </div>
          <div className="head-actions">
            <label className="search-field">
              <Icon name="search" size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    clearSearch()
                  }
                }}
                placeholder={t('gallery.searchPlaceholder')}
                spellCheck={false}
              />
              {query && (
                <button
                  className="search-clear"
                  onClick={(event) => {
                    event.preventDefault()
                    clearSearch()
                  }}
                  title={t('common.clear')}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </label>
            <label className="mini-field" title={t('gallery.sort')}>
              <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label={t('gallery.sort')}>
                <option value="new">{t('gallery.sortNew')}</option>
                <option value="old">{t('gallery.sortOld')}</option>
                <option value="size">{t('gallery.sortSize')}</option>
                <option value="name">{t('gallery.sortName')}</option>
              </select>
            </label>
            <label className="mini-field" title={t('gallery.filter')}>
              <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t('gallery.filter')}>
                <option value="all">{t('gallery.filterAll')}</option>
                <option value="photo">{t('gallery.filterPhotos')}</option>
                <option value="video">{t('gallery.filterVideos')}</option>
                <option value="gif">{t('gallery.filterGifs')}</option>
              </select>
            </label>
            {gridView ? (
              <button className={`btn btn-sm ${selecting ? 'btn-primary' : ''}`} onClick={() => (selecting ? leaveSelection() : setSelecting(true))}>
                <Icon name={selecting ? 'x' : 'check'} size={14} />
                {selecting ? t('gallery.exit') : t('gallery.selectMode')}
              </button>
            ) : null}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {!gridView ? (
            <motion.div key="albums" className="album-grid" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {albums.map((entry, index) => (
                <motion.button
                  key={entry.name}
                  className="album-card"
                  onClick={() => openAlbum(entry.name)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.02, 0.25) }}
                >
                  <div className={`album-cover ${entry.items.length === 1 ? 'single' : ''}`}>
                    {entry.items.slice(0, 4).map((item) => (
                      <Thumb key={item.path} item={item} size={320} className="cover-thumb" videoFallback lazy />
                    ))}
                    {entry.items.length > 1 &&
                      Array.from({ length: Math.max(0, 4 - entry.items.length) }).map((_, index) => (
                        <div className="cover-empty" key={`empty-${index}`} />
                      ))}
                  </div>
                  <div className="album-info">
                    <div className="album-name" title={entry.name}>
                      {entry.name}
                    </div>
                    <div className="album-sub">
                      {t('common.item', { n: entry.items.length.toLocaleString(locale) })} • {formatBytes(entry.bytes, lang)}
                    </div>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          ) : (
            <motion.div key={`grid-${album || 'all'}-${searching ? 'q' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {selecting && (
                <div className="select-toolbar">
                  <span className="badge">{t('gallery.selecting', { n: selectedItems.length })}</span>
                  <button className="btn btn-sm" onClick={selectAll} disabled={!visible.length || busy} title={allSelected ? t('gallery.clearAll') : t('select.all')}>
                    <Icon name={allSelected ? 'x' : 'check'} size={14} />
                    {allSelected ? t('gallery.clearAll') : t('select.all')}
                  </button>
                  <div className="toolbar-spacer" />
                  <button className="btn btn-sm btn-primary" disabled={!selectedItems.length || busy} onClick={requestReview}>
                    <Icon name="sparkle" size={14} />
                    {t('gallery.reviewSelected')}
                  </button>
                  <button className="btn btn-sm btn-danger" disabled={!selectedItems.length || busy} onClick={() => requestBulk('trash')}>
                    <Icon name="trash" size={14} />
                    {t('gallery.trash')}
                  </button>
                  <button className="btn btn-sm" disabled={!selectedItems.length || busy} onClick={() => requestBulk('permanent')}>
                    <Icon name="x" size={14} />
                    {t('gallery.destroy')}
                  </button>
                </div>
              )}

              {visible.length === 0 ? (
                <Empty
                  icon="search"
                  title={filter !== 'all' ? t('gallery.filterEmpty') : t('gallery.noResults')}
                  sub={t('gallery.noResultsHint')}
                />
              ) : (
                <div
                  ref={setGridRef}
                  className="tile-grid"
                  style={{
                    '--tile': `${TILE[settings.gridSize] || TILE.medium}px`,
                    paddingTop: gridWindow.top ? `${gridWindow.top}px` : undefined,
                    paddingBottom: gridWindow.bottom ? `${gridWindow.bottom}px` : undefined
                  }}
                >
                  {visible.slice(gridWindow.start, gridWindow.end).map((item) => (
                    <div
                      key={item.path}
                      className={`tile ${selected.has(item.path) ? 'selected' : ''}`}
                      onClick={(event) => (selecting ? (event.shiftKey ? selectRange(item) : toggle(item)) : setZoomPath(item.path))}
                      title={item.name}
                    >
                      <Thumb item={item} size={360} className="tile-media" videoFallback lazy />
                      <span className="veil" />
                      <span className="type">
                        <Icon name={item.kind === 'video' ? 'video' : item.ext === '.gif' ? 'film' : 'image'} size={12} />
                        {formatBytes(item.size, lang)}
                      </span>
                      <span className="pick">
                        <Icon name="check" size={12} strokeWidth={3} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {zoomItem && (
          <ZoomLayer
            item={zoomItem}
            onClose={() => setZoomPath(null)}
            onPrev={zoomIndex > 0 ? () => setZoomPath(visible[zoomIndex - 1].path) : null}
            onNext={zoomIndex < visible.length - 1 ? () => setZoomPath(visible[zoomIndex + 1].path) : null}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
