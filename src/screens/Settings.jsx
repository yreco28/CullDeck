import React, { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { Segmented, Switch } from '../components/ui'
import { useI18n } from '../i18n'
import { formatBytes } from '../lib/format'

export default function Settings({ settings, onChange, onResetStats, onOpenData, onPick, onRemoveFolder, onRescan, version, userData, onConfirm, onClearCache, rootStatus, onFixFolder }) {
  const { t, lang } = useI18n()
  const folders = settings.rootFolders || []
  const [cache, setCache] = useState(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let alive = true
    window.api
      .thumbStats()
      .then((stats) => {
        if (alive) setCache(stats)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="screen">
      <div className="screen-inner">
        <div className="screen-head">
          <div>
            <div className="page-title">{t('settings.title')}</div>
            <div className="page-sub">{t('app.tagline')}</div>
          </div>
        </div>

        <div className="settings-grid">
          <section className="settings-card">
            <div className="settings-card-title">{t('settings.appearance')}</div>

            <div className="row">
              <div>
                <div className="row-label">{t('settings.theme')}</div>
              </div>
              <Segmented
                value={settings.theme}
                onChange={(value) => onChange({ theme: value })}
                options={[
                  { value: 'dark', label: t('settings.dark'), icon: 'moon' },
                  { value: 'light', label: t('settings.light'), icon: 'sun' },
                  { value: 'system', label: t('settings.system'), icon: 'gear' }
                ]}
              />
            </div>

            <div className="row">
              <div>
                <div className="row-label">{t('settings.language')}</div>
              </div>
              <Segmented
                value={settings.lang}
                onChange={(value) => onChange({ lang: value })}
                options={[
                  { value: 'tr', label: 'Türkçe' },
                  { value: 'en', label: 'English' }
                ]}
              />
            </div>

            <div className="row">
              <div>
                <div className="row-label">{t('settings.grid')}</div>
                <div className="row-hint">{t('settings.gridHint')}</div>
              </div>
              <Segmented
                value={settings.gridSize}
                onChange={(value) => onChange({ gridSize: value })}
                options={[
                  { value: 'small', label: t('settings.small') },
                  { value: 'medium', label: t('settings.medium') },
                  { value: 'large', label: t('settings.large') }
                ]}
              />
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.behaviour')}</div>

            <div className="row">
              <div>
                <div className="row-label">{t('settings.swipe')}</div>
              </div>
              <Segmented
                value={settings.swipe}
                onChange={(value) => onChange({ swipe: value })}
                options={[
                  { value: 'left-delete', label: '← ' + t('review.delete') },
                  { value: 'right-delete', label: t('review.delete') + ' →' }
                ]}
              />
            </div>

            <div className="row">
              <div>
                <div className="row-label">{t('settings.deleteMode')}</div>
                <div className="row-hint">
                  {settings.deleteMode === 'trash' ? t('settings.trashHint') : t('settings.permanentHint')}
                </div>
              </div>
              <Segmented
                value={settings.deleteMode}
                onChange={(value) => onChange({ deleteMode: value })}
                options={[
                  { value: 'trash', label: t('settings.trash'), icon: 'trash' },
                  { value: 'permanent', label: t('settings.permanent'), icon: 'x' }
                ]}
              />
            </div>

            <div className="row">
              <div>
                <div className="row-label">{t('settings.videos')}</div>
                <div className="row-hint">{t('settings.videosHint')}</div>
              </div>
              <Switch on={settings.showVideos} onChange={(value) => onChange({ showVideos: value })} label={t('settings.videos')} />
            </div>

            <div className="row">
              <div>
                <div className="row-label">{t('settings.sounds')}</div>
                <div className="row-hint">{t('settings.soundsHint')}</div>
              </div>
              <Switch
                on={settings.soundEffects !== false}
                onChange={(value) => onChange({ soundEffects: value })}
                label={t('settings.sounds')}
              />
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.folder')}</div>
            <div className="row stack">
              <div style={{ minWidth: 0 }}>
                <div className="row-label">{folders.length > 1 ? t('home.folders') : t('settings.folder')}</div>
                {folders.length ? (
                  <div className="folder-list">
                    {folders.map((folder) => {
                      const key = String(folder || '').replace(/[\\/]+$/, '').toLowerCase()
                      const status = (rootStatus || []).find((entry) => String(entry?.path || '').replace(/[\\/]+$/, '').toLowerCase() === key)
                      const broken = Boolean(status && !status.ok)
                      return (
                        <div className={`folder-row ${broken ? 'is-broken' : ''}`} key={folder}>
                          <span className="folder-path" title={folder}>
                            {folder}
                          </span>
                          {broken && (
                            <>
                              <span className="folder-broken-label">
                                {t('settings.brokenMissing')}
                              </span>
                              <button type="button" className="folder-fix" onClick={() => onFixFolder?.(folder)} title={t('settings.fix')}>
                                <Icon name="undo" size={12} strokeWidth={2.4} />
                                {t('settings.fix')}
                              </button>
                            </>
                          )}
                          <button type="button" className="folder-remove" onClick={() => onRemoveFolder(folder)} title={t('home.removeFolder')}>
                            <Icon name="x" size={11} strokeWidth={2.6} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="folder-path is-empty">{t('home.noFolder')}</div>
                )}
                <div className="row-hint">{t('settings.folderHint')}</div>
              </div>
              <div className="row-actions">
                {folders.length > 0 && (
                  <button className="btn btn-sm" onClick={onRescan}>
                    <Icon name="undo" size={14} />
                    {t('home.rescan')}
                  </button>
                )}
                <button className="btn btn-sm btn-primary" onClick={onPick}>
                  <Icon name="folder" size={14} />
                  {folders.length ? t('home.addFolder') : t('home.pick')}
                </button>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.data')}</div>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div className="row-label">{t('settings.storage')}</div>
                <div className="row-hint mono" style={{ wordBreak: 'break-all' }}>
                  {userData}
                </div>
              </div>
              <button className="btn btn-sm" onClick={onOpenData}>
                <Icon name="external" size={14} />
                {t('settings.openFolder')}
              </button>
            </div>
            <div className="row">
              <div>
                <div className="row-label">{t('settings.reset')}</div>
                <div className="row-hint">{t('settings.resetHint')}</div>
              </div>
              <button
                className="btn btn-sm btn-danger"
                onClick={() =>
                  onConfirm({
                    title: t('settings.reset'),
                    body: t('settings.resetConfirm'),
                    danger: true,
                    confirmLabel: t('settings.reset'),
                    onConfirm: onResetStats
                  })
                }
              >
                <Icon name="trash" size={14} />
                {t('settings.reset')}
              </button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.cache')}</div>
            <div className="row">
              <div style={{ minWidth: 0 }}>
                <div className="row-label">{t('settings.cache')}</div>
                <div className="row-hint">
                  {t('settings.cacheHint', {
                    size: formatBytes(cache?.bytes || 0, lang),
                    n: (cache?.count || 0).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')
                  })}
                </div>
              </div>
              <button
                className="btn btn-sm"
                disabled={clearing}
                onClick={async () => {
                  if (!onClearCache) return
                  setClearing(true)
                  try {
                    const next = await onClearCache()
                    if (next) setCache(next)
                  } finally {
                    setClearing(false)
                  }
                }}
              >
                {clearing ? <span className="spinner" /> : <Icon name="trash" size={14} />}
                {t('settings.clearCache')}
              </button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.shortcuts')}</div>
            <div className="kbd-list">
              <div className="kbd-row">
                <span>← / →</span>
                <span>{t('settings.sc.arrows')}</span>
              </div>
              <div className="kbd-row">
                <span>
                  <kbd>Space</kbd>
                </span>
                <span>{t('settings.sc.space')}</span>
              </div>
              <div className="kbd-row">
                <span>
                  <kbd>Ctrl</kbd> + <kbd>Z</kbd>
                </span>
                <span>{t('settings.sc.undo')}</span>
              </div>
              <div className="kbd-row">
                <span>
                  <kbd>Esc</kbd>
                </span>
                <span>{t('settings.sc.esc')}</span>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-title">{t('settings.about')}</div>
            <div className="about-row">
              <img className="about-icon" src="./icon.png" alt="CullDeck" draggable={false} />
              <div>
                <div className="row-label">CullDeck</div>
                <div className="row-hint">{t('settings.version', { v: version })}</div>
                <a
                  className="about-link"
                  href="https://github.com/yreco28/CullDeck"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
              </div>
            </div>
            <div className="row">
              <div className="row-hint">{t('settings.credits')}</div>
            </div>
            <div className="row">
              <span className="muted tiny">Mona Sans · Rubik</span>
              <span className="muted tiny">Electron · React</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
