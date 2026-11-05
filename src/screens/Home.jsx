import React from 'react'
import { motion } from 'framer-motion'
import Icon from '../components/Icon'
import { HeroArt } from '../components/ui'
import { useI18n } from '../i18n'
import { formatBytes, relativeTime } from '../lib/format'
import { scopeLabel } from '../lib/session'

const MODES = [
  { key: 'album', icon: 'folder' },
  { key: 'month', icon: 'clock' },
  { key: 'type', icon: 'layers' },
  { key: 'random', icon: 'shuffle' },
  { key: 'all', icon: 'sparkle' }
]

export default function Home({
  library,
  totals,
  grandTotals,
  scanProgress,
  scanning,
  review,
  settings,
  sessions,
  reviewable,
  rootStatus,
  onAddFolder,
  onCancelScan,
  onOpenFlow,
  onChooseSession,
  onResumeSession,
  onDiscardSession,
  onNavigate
}) {
  const { t, lang, locale } = useI18n()
  const folders = settings.rootFolders || []
  const available = reviewable?.length || 0
  // Konum değil kararlar esas alınır: son fotoğrafa atlamak ilerlemeyi artırmaz.
  const activeTotal = review?.items?.length || 0
  const activeMarks = review?.marks || {}
  const activeReviewed = review
    ? review.items.reduce((sum, item) => sum + (activeMarks[item.path] ? 1 : 0), 0)
    : 0
  const pending = review ? Math.max(0, activeTotal - activeReviewed) : 0
  const activePct = activeTotal ? Math.round((activeReviewed / activeTotal) * 100) : 0
  const progressPct = scanProgress?.total ? Math.round((scanProgress.count / scanProgress.total) * 100) : 0
  // Kaynak klasör canlı değilse veya taranacak medya bulunamadıysa kalıcı uyarı.
  const rootIssues = (rootStatus || []).filter((entry) => !entry.ok || entry.count === 0)

  // Klasör başına kayıtlı oturumlar (silinen/klasörü kaldırılanlar hariç).
  const sessionList = (sessions || []).filter((entry) => entry.remaining > 0)
  const hasSessions = sessionList.length > 0
  const multipleSessions = sessionList.length > 1
  const firstSession = sessionList[0]
  const sessionTotal = sessionList.reduce((sum, entry) => sum + entry.total, 0)
  const sessionRemaining = sessionList.reduce((sum, entry) => sum + entry.remaining, 0)
  const sessionReviewed = Math.max(0, sessionTotal - sessionRemaining)
  const sessionPct = sessionTotal ? Math.round((sessionReviewed / sessionTotal) * 100) : 0
  const showContinue = hasSessions || pending > 0
  const continuePct = multipleSessions
    ? sessionPct
    : firstSession
      ? (firstSession.total ? Math.round(((firstSession.total - firstSession.remaining) / firstSession.total) * 100) : 0)
      : activePct
  const continueCount = multipleSessions
    ? t('home.sessionFolders', { n: sessionList.length.toLocaleString(locale) })
    : firstSession
      ? `${(firstSession.total - firstSession.remaining).toLocaleString(locale)} / ${firstSession.total.toLocaleString(locale)}`
      : `${activeReviewed.toLocaleString(locale)} / ${activeTotal.toLocaleString(locale)}`
  const continueSub = multipleSessions
    ? t('home.sessionsWaiting', { n: sessionList.length.toLocaleString(locale) })
    : firstSession
      ? `${scopeLabel(firstSession.scope, firstSession.roots, t)} · ${t('home.sessionRemaining', { n: firstSession.remaining.toLocaleString(locale) })}`
      : `${scopeLabel(review?.scope, folders, t)} · ${t('home.sessionRemaining', { n: pending.toLocaleString(locale) })}`

  const handleContinue = () => {
    if (multipleSessions) {
      onChooseSession()
      return
    }
    if (firstSession) {
      onResumeSession(firstSession)
      return
    }
    onNavigate('review')
  }

  return (
    <div className={`screen${!scanning && library ? ' home-ready' : ''}`}>
      <div className="screen-inner">
        <section className="hero">
          <div className="hero-text">
            <div className="greeting">{t('home.hello')}</div>
            <div className="hero-sub">{t('home.sub')}</div>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg" onClick={() => onOpenFlow('album')} disabled={!available || scanning}>
                <Icon name="wand" size={18} />
                {t('home.start')}
              </button>
              <button className="btn btn-lg hero-secondary" onClick={onAddFolder} disabled={scanning}>
                <Icon name="folder" size={17} />
                {folders.length ? t('home.addFolder') : t('home.pick')}
              </button>
            </div>
            <div className="hero-stats">
              <div>
                <div className="hero-stat-value">{totals.count.toLocaleString(locale)}</div>
                <div className="hero-stat-label">{t('home.statItems')}</div>
              </div>
              <div>
                <div className="hero-stat-value">{formatBytes(totals.bytes, lang)}</div>
                <div className="hero-stat-label">{t('home.statSize')}</div>
              </div>
              <div>
                <div className="hero-stat-value">{formatBytes(grandTotals.bytes, lang)}</div>
                <div className="hero-stat-label">{t('stats.freed')}</div>
              </div>
            </div>
          </div>
          <div className="hero-art">
            <div className="glow" />
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
              <HeroArt />
            </motion.div>
          </div>
        </section>

        {rootIssues.length > 0 && (
          <motion.div className="root-warning" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <span className="root-warning-icon">
              <Icon name="info" size={16} />
            </span>
            <div className="root-warning-main">
              <div className="root-warning-title">{t('home.rootWarningTitle')}</div>
              {rootIssues.slice(0, 3).map((entry) => (
                <div className="root-warning-line" key={entry.path} title={entry.path}>
                  {t(entry.ok ? 'home.rootWarningEmpty' : 'home.rootWarningMissing', { name: entry.path })}
                </div>
              ))}
              {rootIssues.length > 3 ? (
                <div className="root-warning-line">{t('home.rootWarningMore', { n: rootIssues.length - 3 })}</div>
              ) : null}
            </div>
          </motion.div>
        )}

        {showContinue && (
          <motion.button className="continue-card rich" onClick={handleContinue} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <span className="pulse" />
            <span className="continue-icon">
              <Icon name="sparkle" size={17} />
            </span>
            <span className="continue-text">
              <span className="continue-title">{t('home.continue')}</span>
              <span className="continue-sub">{continueSub}</span>
              <span className="continue-meter">
                <span style={{ width: `${continuePct}%` }} />
              </span>
            </span>
            <span className="continue-side">
              <span className="continue-count">{continueCount}</span>
              <Icon name="chevronRight" size={18} />
            </span>
          </motion.button>
        )}

        {scanning && (
          <motion.div className="scan-banner" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <div className="scan-banner-main">
              <div className="scan-line">
                {scanProgress?.phase === 'exif'
                  ? t('home.scanningExif', { done: scanProgress.count, total: scanProgress.total || '?' })
                  : `${t('home.scanning')} ${scanProgress?.count ? `${scanProgress.count.toLocaleString(locale)}` : ''}`}
              </div>
              <div className={`scan-meter ${scanProgress?.phase === 'exif' && !scanProgress.total ? 'indeterminate' : ''}`}>
                <div className="fill" style={{ width: `${scanProgress?.phase === 'exif' ? progressPct : 35}%` }} />
              </div>
            </div>
            <button className="btn btn-sm" onClick={onCancelScan}>
              <Icon name="x" size={14} />
              {t('home.cancelScan')}
            </button>
          </motion.div>
        )}

        {sessionList.length > 0 && (
          <>
            <div className="section-head">
              <div className="section-title">{t('home.savedSessions')}</div>
              <span className="muted tiny">{sessionList.length.toLocaleString(locale)}</span>
            </div>
            <div className="saved-session-list">
              {sessionList.map((entry) => {
                const reviewed = Math.max(0, entry.total - entry.remaining)
                const pct = entry.total ? Math.round((reviewed / entry.total) * 100) : 0
                return (
                  <motion.div
                    key={entry.key}
                    className="saved-session-row"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <button
                      type="button"
                      className="saved-session-card"
                      onClick={() => onResumeSession(entry)}
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
                        <span className="saved-session-time">{entry.updatedAt ? relativeTime(entry.updatedAt, locale) : ''}</span>
                        <span className="btn btn-sm">{t('home.resumeSession')}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="saved-session-close"
                      onClick={() => onDiscardSession(entry)}
                      title={t('home.closeSession')}
                      aria-label={t('home.closeSession')}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </motion.div>
                )
              })}
            </div>
          </>
        )}

        <div className="section-head">
          <div className="section-title">{t('home.modes')}</div>
          <span className="hint-arrows">
            <Icon name="keyboard" size={13} />
            {t('home.tip')}
          </span>
        </div>

        <div className="mode-grid">
          {MODES.map((mode, index) => (
            <motion.button
              key={mode.key}
              className="mode-card"
              onClick={() => onOpenFlow(mode.key)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              disabled={!available || scanning}
            >
              <span className="mc-icon">
                <Icon name={mode.icon} size={19} />
              </span>
              <span className="mc-title">{t(`home.mode.${mode.key}`)}</span>
              <span className="mc-desc">{t(`home.mode.${mode.key}Desc`)}</span>
            </motion.button>
          ))}
        </div>

        <div className="section-head">
          <div className="section-title">{t('stats.recent')}</div>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('stats')}>
            {t('gallery.open')}
            <Icon name="chevronRight" size={14} />
          </button>
        </div>

        <div className="metric-grid">
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.freed')}</span>
              <span className="metric-icon">
                <Icon name="database" size={15} />
              </span>
            </div>
            <div className="metric-value">{formatBytes(grandTotals.bytes, lang)}</div>
            <div className="metric-sub">{t('stats.total') || ''}</div>
          </div>
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.reviewed')}</span>
              <span className="metric-icon">
                <Icon name="image" size={15} />
              </span>
            </div>
            <div className="metric-value">{grandTotals.reviewed.toLocaleString(locale)}</div>
            <div className="metric-sub">
              {t('stats.deleted')}: {grandTotals.deleted.toLocaleString(locale)}
            </div>
          </div>
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.kept')}</span>
              <span className="metric-icon">
                <Icon name="check" size={15} />
              </span>
            </div>
            <div className="metric-value">{grandTotals.kept.toLocaleString(locale)}</div>
            <div className="metric-sub">{t('stats.kept')}</div>
          </div>
          <div className="metric">
            <div className="metric-top">
              <span>{t('stats.sessions')}</span>
              <span className="metric-icon">
                <Icon name="clock" size={15} />
              </span>
            </div>
            <div className="metric-value">{grandTotals.sessions.toLocaleString(locale)}</div>
            <div className="metric-sub">{t('stats.avg')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
