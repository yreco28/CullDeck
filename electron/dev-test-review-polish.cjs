'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * İnceleme ekranı düzeltmeleri:
 *  - dosya adı seçilip kopyalanabilir (inceleme + bilgi kartı),
 *  - tam ekranda arkadaki video susar, kapanınca devam eder,
 *  - sona atlayıp "Devam et" denince karar verilmemiş öğeler oturumda kalır,
 *  - ilerleme barı konum değil tut/sil kararları üzerinden ilerler.
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
  const count = (selector) => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
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
    if (!(await waitFor(() => exists('.group-row'), 10000))) return false
    await sleep(300)
    if ((await clickGroup(name)) === 'MISS') return false
    await sleep(300)
    await clickText('incele', '.select-bar .btn-primary')
    return waitReview()
  }
  const press = async (key, wait = 800) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    await sleep(wait)
  }
  const counterText = () => js(`(document.querySelector('.review-counter') || {}).textContent || ''`)
  const barPercent = () =>
    js(
      `(() => { const track = document.querySelector('.review-progress'); const bar = document.querySelector('.review-progress .bar'); if (!track || !bar) return -1; return Math.round((bar.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100) })()`
    )
  const selectText = (selector) =>
    js(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const range = document.createRange(); range.selectNodeContents(el); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); return { text: sel.toString(), userSelect: getComputedStyle(el).userSelect } })()`
    )
  const closeReview = async () => {
    await click('.review-top .btn-ghost.btn-icon', 0)
    await sleep(500)
    if (await exists('.modal .btn-danger')) {
      await click('.modal .btn-danger')
      await sleep(700)
    }
  }

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  check('home ready', await waitHome())

  /* ---- 1. Tam ekran: arkadaki ses durur ---- */
  check('video group opened', await startReviewGroup('C'))
  check(
    'background video playing',
    await waitFor(async () => js(`(() => { const v = document.querySelector('.stage-video video'); return Boolean(v && v.readyState > 0 && !v.paused) })()`), 20000)
  )
  await press('f', 1200)
  check('fullscreen opened', await exists('.fs-layer'))
  check(
    'background video paused in fullscreen',
    await waitFor(async () => js(`(() => { const v = document.querySelector('.stage-video video'); return Boolean(v && v.paused) })()`), 6000)
  )
  check(
    'fullscreen video playing',
    await waitFor(async () => js(`(() => { const v = document.querySelector('.fs-media video'); return Boolean(v && !v.paused) })()`), 12000)
  )
  await shot('p1-fullscreen-single-audio')
  await press('Escape', 1200)
  check('fullscreen closed', !(await exists('.fs-layer')))
  check(
    'background video resumes after fullscreen',
    await waitFor(async () => js(`(() => { const v = document.querySelector('.stage-video video'); return Boolean(v && !v.paused) })()`), 8000)
  )
  await closeReview()
  check('video review closed', !(await exists('.review-screen')))

  /* ---- 2. Dosya adı seçimi + ilerleme barı ---- */
  check('photo group opened', await startReviewGroup('A'))
  const nameInfo = await selectText('.review-info-name')
  check('review file name selectable', nameInfo?.userSelect === 'text', nameInfo?.userSelect)
  check('review file name can be selected', nameInfo?.text === 'img_0001.jpg', nameInfo?.text)

  check('info button exists', await exists('.review-info-btn'))
  await click('.review-info-btn')
  await sleep(600)
  check('info modal opens', await exists('.info-modal'))
  const modalName = await selectText('.info-value.selectable')
  check('info file name selectable', modalName?.userSelect === 'text', modalName?.userSelect)
  check('info file name can be selected', modalName?.text === 'img_0001.jpg', modalName?.text)
  await shot('p2-info-selectable')
  await clickText('Kapat', '.info-modal .modal-actions .btn')
  await sleep(400)

  check('progress starts at 0', (await barPercent()) === 0, `(${await barPercent()})`)
  await press('Right', 900)
  const afterOne = await barPercent()
  check('progress advances after keep', afterOne >= 5 && afterOne <= 6, `(${afterOne})`)
  check('counter advanced', (await counterText()).includes('2 / 20'), await counterText())

  /* ---- 3. Sona atlayıp "Devam et": kalanlar korunur ---- */
  await click('.strip-thumb', 19)
  await sleep(700)
  check('jumped to last photo', (await counterText()).includes('20 / 20'), await counterText())
  const afterJump = await barPercent()
  check('progress ignores jump position', afterJump >= 5 && afterJump <= 6, `(${afterJump})`)
  await shot('p3-progress-by-decisions')

  await click('.pause-btn')
  check('home after continue', await waitHome())
  check('unreviewed session saved', (await count('.saved-session-row')) === 1, `(${await count('.saved-session-row')})`)
  const subs = await js(`[...document.querySelectorAll('.saved-session-sub')].map(el => (el.textContent || '').trim())`)
  check('19 unreviewed items kept', subs[0]?.includes('19'), subs.join(' | '))
  await shot('p4-session-kept')

  await click('.saved-session-card')
  check('session resumes', await waitReview())
  check('resume starts at first unreviewed', (await counterText()).includes('1 / 19'), await counterText())
  check('resume progress reset', await waitFor(async () => (await barPercent()) === 0, 4000), `(${await barPercent()})`)

  /* ---- 4. Sona atlayıp silmeli "Devam et": kalanlar yine korunur ---- */
  await click('.round-btn', 1)
  await sleep(900)
  await click('.strip-thumb', 18)
  await sleep(600)
  check('jumped to last of resumed list', (await counterText()).includes('19 / 19'), await counterText())
  await click('.pause-btn')
  await sleep(700)
  check('pause dialog opens for deletion', await exists('.pause-modal'))
  await shot('p5-pause-dialog')
  await clickText('Çöp kutusuna taşı', '.pause-actions .btn')
  check('done summary shown', await waitFor(() => exists('.done-card'), 15000))
  const doneText = await js(`(document.querySelector('.done-card') || {}).textContent || ''`)
  check('18 unreviewed items remain after delete', doneText.includes('18'), doneText)
  await shot('p6-done-remaining')

  await click('.done-actions .btn-primary')
  check('remaining session reopens', await waitReview())
  check('reopened list starts at first unreviewed', (await counterText()).includes('1 / 18'), await counterText())

  // Son öğeye atla, sadece onu atla ve özetten uygula: kalan 17 öğe korunmalı.
  await click('.strip-thumb', 17)
  await sleep(600)
  await press('Space', 900)
  check('finished summary opens', await exists('.summary-card'))
  await click('.summary-actions .btn-success')
  check('apply shows done summary', await waitFor(() => exists('.done-card'), 15000))
  const applyDone = await js(`(document.querySelector('.done-card') || {}).textContent || ''`)
  check('apply keeps 17 unreviewed items', applyDone.includes('17'), applyDone)
  await click('.done-actions .btn-primary')
  check('apply remaining session starts at 1 / 17', await waitReview() && (await counterText()).includes('1 / 17'), await counterText())

  await closeReview()
  check('review closed', !(await exists('.review-screen')))

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[test] ${passed}/${results.length} passed`)
  if (passed !== results.length) console.log('[test] FAILED:', results.filter((entry) => !entry.ok).map((entry) => entry.name).join(' | '))
  await sleep(300)
  win.close()
}
