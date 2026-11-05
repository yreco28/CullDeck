'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Ses seviyesi kalıcılığı, medya kontrolü sonrası kısayollar,
 * kontrol çubuğunda sürükleme koruması ve tam ekran native butonu.
 */
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
  const text = (selector) => js(`(document.querySelector(${JSON.stringify(selector)})?.textContent || '')`)
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
  const waitHome = () => waitFor(() => exists('.home-ready'), 40000)
  const waitReview = () => waitFor(() => exists('.strip-thumb'), 20000)
  const clickGroup = (name) =>
    js(
      `(() => { const el = [...document.querySelectorAll('.group-row')].find(r => ((r.querySelector('.group-name')?.textContent) || '').trim() === ${JSON.stringify(name)}); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const startReviewGroup = async (name) => {
    await waitFor(async () => (await clickText('Temizlemeye başla')) !== 'MISS', 10000)
    if (!(await waitFor(() => exists('.group-row'), 15000))) return false
    await sleep(400)
    if ((await clickGroup(name)) === 'MISS') return false
    await sleep(400)
    await clickText('incele', '.select-bar .btn-primary')
    return waitReview()
  }
  const press = async (key, wait = 800) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    await sleep(wait)
  }
  const rectOf = (selector, index = 0) =>
    js(
      `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, width: r.width } })()`
    )
  const mouseClick = async (selector, index = 0) => {
    const rect = await rectOf(selector, index)
    if (!rect) return false
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 })
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 })
    await sleep(350)
    return true
  }
  const dragMouse = async (selector, dx, index = 0) => {
    const rect = await rectOf(selector, index)
    if (!rect) return false
    const x = Math.round(rect.x)
    const y = Math.round(rect.y)
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    await sleep(60)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round(dx / 2), y, button: 'left' })
    await sleep(60)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: x + dx, y, button: 'left' })
    await sleep(60)
    win.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y, button: 'left', clickCount: 1 })
    await sleep(700)
    return true
  }
  const setRange = (selector, value, index = 0) =>
    js(
      `(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return 'MISS'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'OK' })()`
    )
  const videoState = () =>
    js(
      `(() => { const v = document.querySelector('.stage-video video'); if (!v) return null; return { volume: v.volume, muted: v.muted, paused: v.paused } })()`
    )
  const fsVideoState = () =>
    js(
      `(() => { const v = document.querySelector('.fs-media video'); if (!v) return null; return { volume: v.volume, muted: v.muted, controlsList: v.getAttribute('controlsList') || '', paused: v.paused } })()`
    )
  const bootstrap = () => js(`window.api.bootstrap()`)

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  check('home ready', await waitHome())
  check('video group opened', await startReviewGroup('C'))
  check(
    'video playing',
    await waitFor(async () => {
      const state = await videoState()
      return Boolean(state && !state.paused && state.volume > 0 && !state.muted)
    }, 20000)
  )

  /* ---- 1. İleri sarma çubuğunu sürüklemek medyayı tut/sil yapmasın ---- */
  const before = await text('.review-counter')
  await dragMouse('.vc-seek', 190, 0)
  const afterDrag = await text('.review-counter')
  const marksAfterDrag = await count('.strip-thumb.keep, .strip-thumb.delete')
  check('seek drag does not advance', before === afterDrag, `${before} -> ${afterDrag}`)
  check('seek drag does not mark verdict', marksAfterDrag === 0, `(${marksAfterDrag})`)
  await shot('a1-seek-drag-safe')

  /* ---- 2. Kontrole tıkladıktan sonra kısayol çalışsın ---- */
  await mouseClick('.vc-seek', 0)
  await press('Right', 1100)
  const afterShortcut = await text('.review-counter')
  check('shortcut works after clicking seek', afterShortcut !== before, `${before} -> ${afterShortcut}`)
  check('shortcut marked one item', (await count('.strip-thumb.keep, .strip-thumb.delete')) === 1)
  await waitFor(async () => {
    const state = await videoState()
    return Boolean(state && !state.paused)
  }, 15000)

  /* ---- 3. Ses seviyesi kaydedilsin ve tam ekranda aynı olsun ---- */
  await mouseClick('.vc-vol', 0)
  check('volume slider set', (await setRange('.vc-vol', 35, 0)) === 'OK')
  await sleep(500)
  const volState = await videoState()
  check('volume applied', Math.abs((volState?.volume ?? 0) - 0.35) < 0.02, `${volState?.volume}`)
  await sleep(500)
  const saved = await bootstrap()
  check('volume saved to settings', Math.abs((saved?.settings?.volume ?? -1) - 0.35) < 0.02, `${saved?.settings?.volume}`)

  await mouseClick('.vc-volume + .vc-btn', 0)
  await sleep(400)
  check('mute applied', Boolean((await videoState())?.muted))
  await sleep(500)
  const savedMuted = await bootstrap()
  check('mute saved to settings', savedMuted?.settings?.muted === true, `${savedMuted?.settings?.muted}`)

  await press('f', 1300)
  check('fullscreen opened after control click', await exists('.fs-layer'))
  const fsState = await fsVideoState()
  check('fullscreen keeps volume', Math.abs((fsState?.volume ?? 0) - 0.35) < 0.02, `${fsState?.volume}`)
  check('fullscreen keeps mute', fsState?.muted === true, `${fsState?.muted}`)
  check('native fullscreen button removed', String(fsState?.controlsList).includes('nofullscreen'), fsState?.controlsList)
  await shot('a2-fullscreen-no-native-fullscreen')
  await press('Escape', 1000)
  check('fullscreen closed', !(await exists('.fs-layer')))

  /* ---- 4. Kapatıp açınca ses ayarı korunsun ---- */
  win.webContents.reload()
  check('home after reload', await waitHome())
  check('video group reopened', await startReviewGroup('C'))
  check(
    'video starts with saved volume',
    await waitFor(async () => {
      const state = await videoState()
      return Boolean(state && !state.paused && Math.abs(state.volume - 0.35) < 0.02 && state.muted === true)
    }, 20000)
  )
  await shot('a3-volume-restored')

  // Temizlik: sesi tekrar aç (diğer testleri etkilemesin).
  await js(`window.api.saveSettings({ volume: 1, muted: false })`)
  const closeBtn = await exists('.review-top .btn-ghost.btn-icon')
  if (closeBtn) {
    await click('.review-top .btn-ghost.btn-icon', 0)
    await sleep(500)
    if (await exists('.modal .btn-danger')) {
      await click('.modal .btn-danger')
      await sleep(700)
    }
  }

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[test] ${passed}/${results.length} passed`)
  if (passed !== results.length) console.log('[test] FAILED:', results.filter((entry) => !entry.ok).map((entry) => entry.name).join(' | '))
  await sleep(300)
  win.close()
}
