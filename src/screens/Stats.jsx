import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import Icon from '../components/Icon'
import { Empty } from '../components/ui'
import { useI18n } from '../i18n'
import { formatBytes, formatDuration, percent, relativeTime, shortDate } from '../lib/format'

const MODE_ICON = { album: 'folder', month: 'clock', type: 'layers', random: 'shuffle', all: 'sparkle', gallery: 'grid' }

export default function Stats({ stats, totals }) {
  const { t, lang, locale } = useI18n()
  const sessions = stats.sessions || []

  const derived = useMemo(() => {
    const reviewed = totals.reviewed || 0
    const deleted = totals.deleted || 0
    const kept = totals.kept || 0
    const decided = deleted + kept
    const keepRatio = decided ? kept / decided : 0
    const timed = sessions.filter((session) => (session.durationMs || 0) > 1500 && session.reviewed > 0)
    const speed = timed.length
      ? Math.round(timed.reduce((sum, session) => sum + session.reviewed / (session.durationMs / 60_000), 0) / timed.length)
      : 0
    const best = sessions.reduce((max, session) => ((session.bytes || 0) > (max?.bytes || 0) ? session : max), null)
    const avg = sessions.length ? Math.round(totals.bytes / sessions.length) : 0
    return { keepRatio, speed, best, avg, deleted, kept }
  }, [sessions, totals])

  const chart = useMemo(() => {
    const list = [...sessions.slice(0, 8)].reverse()
    const max = Math.max(1, ...list.map((session) => session.bytes || 0))
    return list.map((session) => ({
      ...session,
      height: Math.max(3, Math.round(((session.bytes || 0) / max) * 100))
    }))
  }, [sessions])

  const style = derived.keepRatio > 0.82 ? 'Hoarder' : derived.keepRatio > 0.5 ? 'Balanced' : 'Cleaner'
  const styleTitle = t(`stats.style${style}`)
  const styleDesc = t(`stats.style${style}Desc`)

  if (!sessions.length) {
    return (
      <div className="screen">
        <div className="screen-inner">
          <div className="screen-head">
            <div>
              <div className="page-title">{t('stats.title')}</div>
              <div className="page-sub">{t('stats.sub')}</div>
            </div>
          </div>
          <Empty icon="chart" title={t('stats.empty')} sub={t('stats.emptyHint')} />
        </div>
      </div>
    )
  }

  const radius = 62
  const circumference = 2 * Math.PI * radius

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <div>
            <div className="page-title">{t('stats.title')}</div>
            <div className="page-sub">{t('stats.sub')}</div>
          </div>
          <span className="badge olive">
            <Icon name="sparkle" size={12} />
            {styleTitle}
          </span>
        </div>

        <div className="metric-grid">
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.freed')}</span>
              <span className="metric-icon">
                <Icon name="database" size={15} />
              </span>
            </div>
            <div className="metric-value">{formatBytes(totals.bytes, lang)}</div>
            <div className="metric-sub">{t('stats.avg')}: {formatBytes(derived.avg, lang)}</div>
          </div>
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.reviewed')}</span>
              <span className="metric-icon">
                <Icon name="image" size={15} />
              </span>
            </div>
            <div className="metric-value">{totals.reviewed.toLocaleString(locale)}</div>
            <div className="metric-sub">{t('stats.kept')}: {derived.kept.toLocaleString(locale)}</div>
          </div>
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.speed')}</span>
              <span className="metric-icon">
                <Icon name="clock" size={15} />
              </span>
            </div>
            <div className="metric-value">{derived.speed.toLocaleString(locale)}</div>
            <div className="metric-sub">{t('stats.perMinute', { n: '' }).trim()}</div>
          </div>
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.sessions')}</span>
              <span className="metric-icon">
                <Icon name="check" size={15} />
              </span>
            </div>
            <div className="metric-value">{sessions.length.toLocaleString(locale)}</div>
            <div className="metric-sub">
              {t('stats.best')}: {formatBytes(derived.best?.bytes || 0, lang)}
            </div>
          </div>
        </div>

        <div className="split">
          <div className="chart-card">
            <div className="section-title">{t('stats.chartTitle')}</div>
            <div className="bars">
              {chart.map((session) => (
                <div className="bar-col" key={session.id || session.date}>
                  <motion.div
                    className="bar"
                    initial={{ height: 0 }}
                    animate={{ height: `${session.height}%` }}
                    transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                    title={`${shortDate(session.date, locale)} · ${formatBytes(session.bytes, lang)}`}
                  />
                  <div className="bar-label">{new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(new Date(session.date))}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-card">
            <div className="section-title">{t('stats.keepRatio')}</div>
            <div className="ring-wrap">
              <div className="ring">
                <svg width="148" height="148">
                  <defs>
                    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#4ec7cf" />
                      <stop offset="100%" stopColor="#c8d879" />
                    </linearGradient>
                  </defs>
                  <circle cx="74" cy="74" r={radius} fill="none" stroke="var(--panel-strong)" strokeWidth="13" />
                  <motion.circle
                    cx="74"
                    cy="74"
                    r={radius}
                    fill="none"
                    stroke="url(#ringGrad)"
                    strokeWidth="13"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: circumference * (1 - derived.keepRatio) }}
                    transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                </svg>
                <div className="ring-center">
                  <div className="big">{percent(derived.kept, derived.kept + derived.deleted)}%</div>
                  <div className="small">{t('stats.kept')}</div>
                </div>
              </div>
              <div className="legend">
                <span className="legend-item">
                  <span className="dot" style={{ background: '#4ec7cf' }} />
                  {t('stats.kept')}: {derived.kept.toLocaleString(locale)}
                </span>
                <span className="legend-item">
                  <span className="dot" style={{ background: '#c8d879' }} />
                  {t('stats.deleted')}: {derived.deleted.toLocaleString(locale)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="style-card">
          <div className="style-badge">
            <Icon name={style === 'Hoarder' ? 'heart' : style === 'Balanced' ? 'layers' : 'sparkle'} size={24} />
          </div>
          <div>
            <div className="section-title" style={{ marginBottom: 2 }}>{t('stats.style')}</div>
            <div className="page-title" style={{ fontSize: 20 }}>{styleTitle}</div>
            <div className="row-hint">{styleDesc}</div>
          </div>
        </div>

        <div className="section-head">
          <div className="section-title">{t('stats.recent')}</div>
          <span className="muted tiny">{sessions.length}</span>
        </div>

        <div className="session-list">
          {sessions.slice(0, 10).map((session) => (
            <div className="session-row" key={session.id || session.date}>
              <div className="session-mode">
                <Icon name={MODE_ICON[session.mode] || 'sparkle'} size={16} />
              </div>
              <div className="session-main">
                <div className="session-title">
                  {t(`stats.mode.${session.mode}`) || session.mode} · {t('common.item', { n: (session.reviewed || 0).toLocaleString(locale) })}
                </div>
                <div className="session-sub">
                  {relativeTime(session.date, locale)} · {t('stats.kept')} {session.kept || 0} · {t('stats.deleted')} {session.deleted || 0}
                </div>
              </div>
              <div className="session-value">
                <div className="freed">{formatBytes(session.bytes || 0, lang)}</div>
                <div className="muted tiny">{session.durationMs ? formatDuration(session.durationMs, lang) : '—'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
