'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function runTest(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    await sleep(400)
    const image = await win.capturePage()
    await fsp.writeFile(path.join(dir, `${name}.png`), image.toPNG())
    console.log('[shot]', name)
  }
  const clickText = (text, selector = 'button') =>
    js(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => (b.textContent || '').includes(${JSON.stringify(text)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const count = (selector) => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const text = (selector) => js(`(document.querySelector(${JSON.stringify(selector)})?.textContent || '')`)
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const waitFor = async (fn, timeout = 25000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      try {
        if (await fn()) return true
      } catch {
        /* navigation in progress */
      }
      await sleep(250)
    }
    return false
  }
  const waitHome = () =>
    waitFor(async () => (await exists('.home-ready')) && !(await exists('.scan-line')), 40000)
  const waitReview = () => waitFor(() => exists('.strip-thumb'), 15000)
  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[extra] PASS' : '[extra] FAIL', name, extra)
  }

  check('home ready', await waitHome())

  /* ---- English language ---- */
  await clickText('Ayarlar', '.nav-item')
  await sleep(700)
  await clickText('English', '.segmented button')
  await sleep(800)
  check('document lang switched to en', (await js('document.documentElement.lang')) === 'en')
  check('English nav label', (await js(`[...document.querySelectorAll('.nav-item')].some(n => (n.textContent||'').includes('Settings'))`)))
  await shot('x1-settings-en')

  /* ---- light theme ---- */
  await clickText('Light', '.segmented button')
  await sleep(600)
  check('light theme applied', (await js('document.documentElement.dataset.theme')) === 'light')
  await shot('x2-light-theme')
  await clickText('Dark', '.segmented button')
  await sleep(500)

  /* ---- English duration in Stats ---- */
  await js(
    `window.api.addSession({ id: 'extra-1', date: Date.now(), mode: 'album', reviewed: 10, kept: 5, deleted: 3, skipped: 2, bytes: 1024, durationMs: 65000 })`
  )
  win.webContents.reload()
  check('home after reload', await waitHome())
  await clickText('Statistics', '.nav-item')
  await sleep(800)
  const rows = await js(`[...document.querySelectorAll('.session-row')].map(r => r.textContent)`)
  check('duration uses EN units', rows.some((row) => row.includes('1m 5s')), JSON.stringify(rows.slice(0, 2)))
  check('no Turkish units in EN stats', !rows.some((row) => /(sn|dk)\b/.test(row)))
  await shot('x3-stats-en-duration')

  /* ---- fullscreen zoom + metadata ---- */
  await clickText('Clean', '.nav-item')
  await sleep(700)
  await clickText('Start cleaning')
  await sleep(700)
  check('folder selection starts empty (EN)', (await js(`document.querySelectorAll('.group-row.selected').length`)) === 0)
  check('review button disabled without selection (EN)', await js(`document.querySelector('.select-bar .btn-primary')?.disabled === true`))
  await clickText('Select all', '.bulk-tools .btn')
  await sleep(450)
  const startBtn = await js(
    `(() => { const el = document.querySelector('.select-bar .btn-primary'); if (!el) return 'MISS'; el.click(); return 'OK' })()`
  )
  check('review started (EN)', startBtn === 'OK' && (await waitReview()))
  // mark current as kept so the strip badge appears
  await js(`document.querySelector('.round-btn.keep')?.click()`)
  await sleep(500)

  const sizes = await js(
    `(() => {
      const thumb = document.querySelector('.strip-thumb');
      const mark = document.querySelector('.strip-mark');
      const t = thumb?.getBoundingClientRect();
      const m = mark?.getBoundingClientRect();
      return { thumb: t ? [Math.round(t.width), Math.round(t.height)] : null, mark: m ? [Math.round(m.width), Math.round(m.height)] : null };
    })()`
  )
  check('strip thumb is 46x46', sizes.thumb && sizes.thumb[0] === 46 && sizes.thumb[1] === 46, JSON.stringify(sizes.thumb))
  check('strip badge is 16x16', sizes.mark && sizes.mark[0] === 16 && sizes.mark[1] === 16, JSON.stringify(sizes.mark))

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'f' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'f' })
  check('fullscreen opens with F', await waitFor(() => exists('.fs-layer'), 6000))
  check('fullscreen metadata chips', (await count('.fs-meta span')) > 0, `(${await count('.fs-meta span')})`)
  check('fullscreen zoom controls', await exists('.fs-zoom'))

  await js(`document.querySelector('.fs-media')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(500)
  const zoomValue = await text('.fs-zoom-value')
  check('double-click zooms in', zoomValue && zoomValue !== '100%', zoomValue)
  check('zoomed image scale applied', (await js(`document.querySelector('.fs-media img')?.style.transform.includes('scale(2.4)') ?? false`)))
  await shot('x4-fullscreen-zoom')

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  check('Esc closes fullscreen', await waitFor(async () => !(await exists('.fs-layer')), 5000))

  // restore Turkish for the user data used by other runs
  await js(`window.api.saveSettings({ lang: 'tr' })`)

  const failed = results.filter((entry) => !entry.ok)
  console.log(`[extra] ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) console.log('[extra] FAILED:', failed.map((entry) => entry.name).join(' | '))
  await sleep(300)
  win.close()
}
