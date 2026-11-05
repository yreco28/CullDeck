'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Video üzerinde grab, oynatma kontrol baloncuğunda normal imleç. */
module.exports = async function runTest(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const waitFor = async (fn, timeout = 30000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      try {
        if (await fn()) return true
      } catch {
        /* navigation */
      }
      await sleep(250)
    }
    return false
  }
  const clickText = (text, selector = 'button') =>
    js(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => (b.textContent || '').includes(${JSON.stringify(text)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const clickGroup = (name) =>
    js(
      `(() => { const el = [...document.querySelectorAll('.group-row')].find(r => ((r.querySelector('.group-name')?.textContent) || '').trim() === ${JSON.stringify(name)}); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  check('home ready', await waitFor(() => exists('.home-ready'), 40000))
  await waitFor(async () => (await clickText('Temizlemeye başla')) !== 'MISS', 10000)
  check('group list ready', await waitFor(() => exists('.group-row'), 15000))
  await sleep(400)
  check('video group selected', (await clickGroup('C')) !== 'MISS')
  await sleep(400)
  await clickText('incele', '.select-bar .btn-primary')
  check('review opened', await waitFor(() => exists('.stage-video video'), 20000))

  const cursors = await js(
    `(() => { const v = document.querySelector('.stage-video video'); const c = document.querySelector('.video-controls'); return { video: v ? getComputedStyle(v).cursor : null, controls: c ? getComputedStyle(c).cursor : null, time: getComputedStyle(document.querySelector('.vc-time')).cursor } })()`
  )
  check('video cursor grab', cursors.video === 'grab', cursors.video)
  check('controls cursor default', cursors.controls === 'default', cursors.controls)
  check('controls time cursor default', cursors.time === 'default', cursors.time)

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[test] ${passed}/${results.length} passed`)
  if (passed !== results.length) console.log('[test] FAILED:', results.filter((entry) => !entry.ok).map((entry) => entry.name).join(' | '))

  await js(`(() => { const el = document.querySelector('.review-top .btn-ghost.btn-icon'); if (el) el.click(); return true })()`)
  await sleep(600)
  if (await exists('.modal .btn-danger')) {
    await js(`(() => { const el = document.querySelector('.modal .btn-danger'); if (el) el.click(); return true })()`)
    await sleep(700)
  }
  await sleep(300)
  win.close()
}
