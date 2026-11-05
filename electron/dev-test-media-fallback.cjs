'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Desteklenmeyen medya (AVI/TIFF) için geri dönüş kartı. */
module.exports = async function runTest(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    await sleep(400)
    const image = await win.capturePage()
    await fsp.writeFile(path.join(dir, `${name}.png`), image.toPNG())
    console.log('[shot]', name)
  }
  const click = (selector, index = 0) =>
    js(
      `(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = list[${index}]; if (!el) return 'MISS'; el.click(); return 'OK:' + list.length })()`
    )
  const clickText = (text, selector = 'button') =>
    js(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => (b.textContent || '').includes(${JSON.stringify(text)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const count = (selector) => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const waitFor = async (fn, timeout = 25000) => {
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
  const openByName = (name) =>
    js(
      `(() => { const el = [...document.querySelectorAll('.review-strip-track .strip-thumb')].find(b => (b.getAttribute('title') || '').includes(${JSON.stringify(name)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  check('home ready', await waitFor(() => exists('.home-ready'), 40000))
  await waitFor(async () => (await clickText('Temizlemeye başla')) !== 'MISS', 10000)
  await waitFor(() => exists('.group-row'), 10000)
  await js(
    `(() => { const el = [...document.querySelectorAll('.group-row')].find(r => ((r.querySelector('.group-name')?.textContent) || '').trim() === 'C'); if (!el) return 'MISS'; el.click(); return 'OK' })()`
  )
  await sleep(300)
  await clickText('incele', '.select-bar .btn-primary')
  check('review opened', await waitFor(() => exists('.strip-thumb'), 20000))

  /* ---- Sesli başlatma: oynatılabilir video ---- */
  check('playable thumb exists', (await openByName('ok.mp4')) !== 'MISS')
  check(
    'video starts unmuted',
    await waitFor(
      async () =>
        js(`(() => { const v = document.querySelector('.stage-video video'); return Boolean(v && v.muted === false) })()`),
      10000
    )
  )
  check(
    'video autoplays',
    await waitFor(async () => js(`(() => { const v = document.querySelector('.stage-video video'); return Boolean(v && v.readyState > 0 && !v.paused) })()`), 15000)
  )
  await shot('m0-video-sound')

  /* ---- AVI: oynatılamayan video ---- */
  check('avi thumb exists', (await openByName('bad.avi')) !== 'MISS')
  await sleep(700)
  check('avi shows fallback card', await exists('.media-fallback'))
  const videoText = await js(`(document.querySelector('.media-fallback') || {}).textContent || ''`)
  check('fallback explains playback', videoText.includes('oynatılamıyor') && videoText.includes('Harici uygulamada aç'), videoText)
  check('no broken video element', (await count('.stage-video video')) === 0)
  await shot('m1-video-fallback')

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'f' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'f' })
  await sleep(900)
  check('fullscreen opens on unsupported video', await exists('.fs-layer'))
  check('fullscreen shows fallback', await exists('.fs-layer .media-fallback.is-fullscreen'))
  await shot('m2-fullscreen-fallback')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  check('fullscreen closes', await waitFor(async () => !(await exists('.fs-layer')), 5000))

  /* ---- TIFF: tarayıcının çözemediği görsel ---- */
  check('tiff thumb exists', (await openByName('pic.tiff')) !== 'MISS')
  check(
    'tiff shows Windows preview',
    await waitFor(async () => (await count('.media-fallback-poster')) === 1, 8000)
  )
  const imageText = await js(`(document.querySelector('.media-fallback') || {}).textContent || ''`)
  check('tiff fallback explains preview', imageText.includes('görüntülenemiyor') && imageText.includes('önizlemesi'), imageText)
  await shot('m3-image-fallback')

  // Oturumu uygulamadan kapat.
  await click('.review-top .btn-ghost.btn-icon', 0)
  await sleep(500)
  if (await exists('.modal .btn-danger')) {
    await click('.modal .btn-danger')
    await sleep(700)
  }
  check('review closed', !(await exists('.review-screen')))

  const passed = results.filter((r) => r.ok).length
  console.log(`[media] ${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
  await sleep(300)
  win.close()
}
