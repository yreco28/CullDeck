import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import Icon from '../components/Icon'
import { Empty, Thumb } from '../components/ui'
import { useI18n } from '../i18n'
import { formatBytes, monthLabel } from '../lib/format'
import { groupKeyOf } from '../App'

const TYPE_ORDER = { image: 0, video: 1, gif: 2 }

function shuffle(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export default function Select({ mode, library, flow, setFlow, onBack, onStart }) {
  const { t, lang, locale } = useI18n()
  const allItems = library?.items || []

  const groups = useMemo(() => {
    if (!library || mode === 'random' || mode === 'all') return []
    const map = new Map()
    for (const item of library.items) {
      const key = groupKeyOf(item, mode)
      if (!map.has(key)) map.set(key, { key, items: [], bytes: 0 })
      const group = map.get(key)
      group.items.push(item)
      group.bytes += item.size
    }
    const list = [...map.values()]
    if (mode === 'month') list.sort((a, b) => b.key.localeCompare(a.key))
    else if (mode === 'type') list.sort((a, b) => (TYPE_ORDER[a.key] ?? 9) - (TYPE_ORDER[b.key] ?? 9))
    else list.sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key))
    return list
  }, [library, mode])

  const selectedGroups = groups.filter((group) => flow.selected.has(group.key))
  const randomItems = useMemo(() => shuffle(allItems).slice(0, Math.min(flow.random, allItems.length)), [allItems, flow.random])
  const chosenItems = mode === 'random' ? randomItems.length : mode === 'all' ? allItems.length : selectedGroups.reduce((sum, group) => sum + group.items.length, 0)
  const chosenBytes = mode === 'random' ? randomItems.reduce((sum, item) => sum + item.size, 0) : mode === 'all' ? allItems.reduce((sum, item) => sum + item.size, 0) : selectedGroups.reduce((sum, group) => sum + group.bytes, 0)
  const excluded = groups.length - selectedGroups.length

  const label = (group) => {
    if (mode === 'month') return monthLabel(group.key, locale)
    if (mode === 'type') return t(`media.${group.key}`)
    return group.key
  }

  const toggle = (key) => {
    const next = new Set(flow.selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setFlow({ ...flow, selected: next })
  }

  const start = () => {
    if (!chosenItems) return
    if (mode === 'random') return onStart(randomItems, 'random')
    if (mode === 'all') return onStart(allItems, 'all')
    const items = selectedGroups.flatMap((group) => group.items)
    return onStart(items, mode)
  }

  if (!allItems.length) {
    return (
      <div className="screen">
        <div className="screen-inner">
          <div className="screen-head">
            <div>
              <button className="btn btn-ghost btn-sm back-btn" onClick={onBack}>
                <Icon name="arrowLeft" size={15} />
                {t('common.cancel')}
              </button>
              <div className="page-title">{t('select.title')}</div>
            </div>
          </div>
          <Empty icon="folder" title={t('gallery.empty')} sub={t('gallery.emptyHint')} />
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <div>
            <button className="btn btn-ghost btn-sm back-btn" onClick={onBack}>
              <Icon name="arrowLeft" size={15} />
              {t('common.cancel')}
            </button>
            <div className="page-title">{t('select.title')}</div>
            <div className="page-sub">{t(`select.sub.${mode === 'random' || mode === 'all' ? mode : mode}`)}</div>
          </div>
          {groups.length > 0 && (
            <div className="bulk-tools">
              <button className="btn btn-sm btn-ghost" onClick={() => setFlow({ ...flow, selected: new Set(groups.map((group) => group.key)) })}>
                {t('select.all')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setFlow({ ...flow, selected: new Set() })}>
                {t('select.none')}
              </button>
            </div>
          )}
        </div>

        {mode === 'random' ? (
          <div className="random-box">
            <div className="random-icon">
              <Icon name="shuffle" size={22} />
            </div>
            <div className="random-main">
              <div className="random-title">{t('select.randomLabel')}</div>
              <div className="row-hint">{t('select.randomHint')}</div>
              <input
                className="range"
                type="range"
                min={30}
                max={Math.min(500, Math.max(30, allItems.length))}
                step={10}
                value={Math.min(flow.random, Math.min(500, Math.max(30, allItems.length)))}
                style={{ '--pct': `${((flow.random - 30) / Math.max(1, Math.min(500, allItems.length) - 30)) * 100}%` }}
                onChange={(event) => setFlow({ ...flow, random: Number(event.target.value) })}
              />
            </div>
            <div className="stepper">
              <button onClick={() => setFlow({ ...flow, random: Math.max(30, flow.random - 10) })}>
                <Icon name="minimize" size={16} />
              </button>
              <input
                type="number"
                min={30}
                max={500}
                value={flow.random}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setFlow({ ...flow, random: Number.isFinite(value) ? Math.max(30, Math.min(500, value)) : 30 })
                }}
              />
              <button onClick={() => setFlow({ ...flow, random: Math.min(500, flow.random + 10) })}>
                <span className="plus">+</span>
              </button>
            </div>
          </div>
        ) : mode === 'all' ? (
          <div className="all-card">
            <div className="all-icon">
              <Icon name="sparkle" size={26} />
            </div>
            <div>
              <div className="all-title">{t('home.mode.all')}</div>
              <div className="row-hint">{t('select.sub.all')}</div>
            </div>
            <div className="all-count">
              <div className="v">{allItems.length.toLocaleString(locale)}</div>
              <div className="l">{formatBytes(chosenBytes, lang)}</div>
            </div>
          </div>
        ) : (
          <div className="group-list">
            {groups.map((group, index) => {
              const active = flow.selected.has(group.key)
              return (
                <motion.button
                  key={group.key}
                  className={`group-row ${active ? 'selected' : ''}`}
                  onClick={() => toggle(group.key)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.015, 0.2) }}
                >
                  <div className="group-cover">
                    <Thumb item={group.items[0]} size={160} className="group-thumb" />
                  </div>
                  <div className="group-meta">
                    <div className="group-name">{label(group)}</div>
                    <div className="group-sub">
                      {t('common.item', { n: group.items.length.toLocaleString(locale) })} • {formatBytes(group.bytes, lang)}
                    </div>
                  </div>
                  <span className="check">
                    <Icon name="check" size={13} strokeWidth={2.6} />
                  </span>
                </motion.button>
              )
            })}
          </div>
        )}

        <div className="select-bar">
          <div className="select-bar-info">
            <div className="select-bar-title">
              {groups.length > 0 ? t('select.included', { n: selectedGroups.length }) : t('select.total')}
            </div>
            <div className="select-bar-sub">
              {chosenItems.toLocaleString(locale)} • {formatBytes(chosenBytes, lang)}
              {excluded > 0 ? ` • ${t('select.excluded', { n: excluded })}` : ''}
            </div>
          </div>
          <button className="btn btn-primary" onClick={start} disabled={!chosenItems}>
            <Icon name="play" size={15} filled />
            {t('select.start', { n: chosenItems.toLocaleString(locale) })}
          </button>
        </div>
      </div>
    </div>
  )
}
