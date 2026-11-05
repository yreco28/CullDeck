'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Son 4 arayüz düzeltmesi: galeri, ayar notu, oturum kapatma, Enter kısayolu. */
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
    // Çoklu oturum özelliği: aynı moddan kayıtlı oturum varsa onay penceresi çıkar.
    if (await exists('.session-choice-actions')) {
      console.log('[test] conflict modal -> end previous')
      await clickText('Öncekilerini sonlandır', '.session-choice-actions .btn')
      await sleep(400)
    }
    return waitReview()
  }
  const goHome = async () => {
    await clickText('Temizle', '.nav-item')
    await sleep(600)
    await waitFor(() => exists('.home-ready'), 15000)
  }

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  /* ---- 1. Galeri: "Değiştir" butonu yok ---- */
  check('home ready', await waitHome())
  await clickText('Galeri', '.nav-item')
  await sleep(700)
  const hasChange = await js(
    `[...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('Değiştir'))`
  )
  check('gallery "Değiştir" removed', !hasChange)
  check('gallery album view still works', (await count('.album-card')) > 0, `(${await count('.album-card')})`)
  await shot('u1-gallery')

  /* ---- 2. Ayarlar: ızgara notu var, Enter kısayolu yok ---- */
  await clickText('Ayarlar', '.nav-item')
  await sleep(700)
  const settingsText = await js(`document.body.textContent || ''`)
  check('grid hint shown', settingsText.includes('Galeri ızgarasındaki') && settingsText.includes('boyutunu belirler.'))
  const hasEnterKbd = await js(
    `[...document.querySelectorAll('kbd')].some(k => (k.textContent || '').trim() === 'Enter')`
  )
  check('Enter shortcut row removed', !hasEnterKbd)
  await shot('u2-settings')

  /* ---- 3. Kayıtlı oturum: çarpı ile kapat ---- */
  await goHome()
  check('A review opened', await startReviewGroup('A'))
  await shot('u5-review')
  await click('.round-btn.small', 1)
  await sleep(650)
  await click('.pause-btn')
  await sleep(900)
  check('one saved session', (await count('.saved-session-card')) === 1, `(${await count('.saved-session-card')})`)
  check('close button exists', await exists('.saved-session-close'))
  await shot('u3-home-session')
  await click('.saved-session-close')
  await sleep(400)
  check('close asks for confirmation', await exists('.modal .btn-danger'))
  await shot('u3-confirm')
  await clickText('İptal', '.modal-actions .btn')
  await sleep(400)
  check('cancel keeps the session', (await count('.saved-session-card')) === 1, `(${await count('.saved-session-card')})`)
  await click('.saved-session-close')
  await sleep(400)
  await click('.modal .btn-danger')
  await sleep(800)
  check('close button removed the session', (await count('.saved-session-card')) === 0, `(${await count('.saved-session-card')})`)
  check('continue card gone too', !(await exists('.continue-card')))

  /* ---- 4. Seçici içindeki çarpı da oturumu kapatır ---- */
  check('B review opened', await startReviewGroup('B'))
  await click('.round-btn.small', 1)
  await sleep(650)
  await click('.pause-btn')
  await sleep(900)
  check('B session saved', (await count('.saved-session-card')) === 1, `(${await count('.saved-session-card')})`)
  await waitFor(async () => (await clickText('Temizlemeye başla')) !== 'MISS', 10000)
  await waitFor(() => exists('.bulk-tools .btn'), 10000)
  await sleep(300)
  await clickText('Tümünü seç', '.bulk-tools .btn')
  await sleep(400)
  await clickText('incele', '.select-bar .btn-primary')
  // Çoklu oturum özelliği: aynı moddan kayıtlı oturum varsa onay penceresi çıkar.
  if (await exists('.session-choice-actions')) {
    console.log('[test] conflict modal -> end previous')
    await clickText('Öncekilerini sonlandır', '.session-choice-actions .btn')
    await sleep(400)
  }
  check('C review opened', await waitReview())
  await click('.pause-btn')
  await sleep(900)
  check('two saved sessions', (await count('.saved-session-card')) === 2, `(${await count('.saved-session-card')})`)
  await click('.continue-card')
  await sleep(600)
  check('picker opened', await exists('.resume-picker'))
  const options = await count('.resume-option')
  check('picker lists two sessions', options === 2, `(${options})`)
  check('picker close button exists', await exists('.resume-option-close'))
  await shot('u4-picker')
  await click('.resume-option-close')
  await sleep(400)
  check('picker close asks for confirmation', await exists('.modal .btn-danger'))
  await click('.modal .btn-danger')
  await sleep(700)
  check('picker close removed one session', (await count('.resume-option')) === 1, `(${await count('.resume-option')})`)
  await clickText('İptal', '.modal-actions .btn')
  await sleep(500)
  check('home shows the remaining session', (await count('.saved-session-card')) === 1, `(${await count('.saved-session-card')})`)

  /* ---- 5. İnceleme üst çubuğu: sıralama ---- */
  const stripNames = () =>
    js(
      `[...document.querySelectorAll('.review-strip-track .strip-thumb')].map(el => (el.getAttribute('title') || '').split(' · ').pop())`
    )
  const currentName = () =>
    js(
      `(() => { const el = document.querySelector('.strip-thumb.current'); return el ? (el.getAttribute('title') || '').split(' · ').pop() : null })()`
    )
  const setSort = (value) =>
    js(
      `(() => { const el = document.querySelector('.review-sort'); if (!el) return 'MISS'; const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(
        value
      )}); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value })()`
    )
  const counterText = () => js(`(document.querySelector('.review-counter') || {}).textContent || ''`)

  await goHome()
  check('A review reopened for sort', await startReviewGroup('A'))
  check('sort control exists', await exists('.review-sort'))
  const sortOptions = await count('.review-sort option')
  check('sort has 5 options', sortOptions === 5, `(${sortOptions})`)

  const before = await stripNames()
  const counterBefore = await counterText()
  check('queue starts with img_0001', before[0] === 'img_0001.jpg', `(${before[0]})`)

  const applied = await setSort('dateAsc')
  await sleep(500)
  const asc = await stripNames()
  check('dateAsc applied', applied === 'dateAsc', `(${applied})`)
  check('dateAsc reorders the whole list', asc[0] === 'img_0020.jpg' && asc[asc.length - 1] === 'img_0001.jpg', `(${asc[0]} … ${asc[asc.length - 1]})`)
  check('current follows the new order', (await currentName()) === 'img_0020.jpg', `(${await currentName()})`)
  check('counter unchanged', (await counterText()) === counterBefore, `(${counterBefore})`)

  await setSort('session')
  await sleep(500)
  const sessionOrder = await stripNames()
  check('session order restores the original list', sessionOrder[0] === before[0] && sessionOrder[sessionOrder.length - 1] === before[before.length - 1], `(${sessionOrder[0]})`)
  check('counter still unchanged', (await counterText()) === counterBefore, `(${counterBefore})`)

  await setSort('sizeDesc')
  await sleep(500)
  check('sizeDesc applied', (await js(`document.querySelector('.review-sort').value`)) === 'sizeDesc')

  /* ---- 6. İnceleme: (i) dosya bilgisi penceresi ---- */
  check('info button exists', await exists('.review-info-btn'))
  await click('.review-info-btn')
  await sleep(700)
  check('info modal opens', await exists('.info-modal'))
  const infoRows = await count('.info-modal .info-row')
  check('info modal lists facts', infoRows >= 4, `(${infoRows})`)
  const infoText = await js(`(document.querySelector('.info-modal') || {}).textContent || ''`)
  check('info modal shows file name', infoText.includes('img_'), '')
  await shot('u6-info')
  await clickText('Kapat', '.info-modal .modal-actions .btn')
  check('info modal closes', await waitFor(async () => !(await exists('.info-modal')), 4000))

  await click('.review-info-btn')
  await sleep(600)
  check('info modal reopens', await exists('.info-modal'))
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  check('Esc closes the info modal', await waitFor(async () => !(await exists('.info-modal')), 4000))

  /* ---- 7. Tam ekran: ok tuşu kısayolları ---- */
  const fsName = () => js(`(document.querySelector('.fs-name') || {}).textContent || ''`)
  const press = async (key) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
    await sleep(800)
  }

  await press('f')
  check('fullscreen opens with F', await exists('.fs-layer'))
  const hint = await js(`(document.querySelector('.fs-hint') || {}).textContent || ''`)
  check('fullscreen hints list arrow keys', ['←', '→', '↑', '↓'].every((key) => hint.includes(key)) && hint.includes('tut') && hint.includes('sil'), hint)

  const fsStart = await fsName()
  await press('Right')
  const fsForward = await fsName()
  check('Right arrow goes forward', fsForward && fsForward !== fsStart, `${fsStart} -> ${fsForward}`)
  await press('Left')
  check('Left arrow goes back', (await fsName()) === fsStart, `(${await fsName()})`)

  await press('Up')
  check('Up arrow keeps and advances', (await fsName()) !== fsStart, `(${await fsName()})`)
  check('Up arrow marks keep', (await count('.strip-thumb.keep')) >= 1, `(${await count('.strip-thumb.keep')})`)

  await press('Down')
  check('Down arrow marks delete', (await count('.strip-thumb.delete')) >= 1, `(${await count('.strip-thumb.delete')})`)
  await shot('u7-fullscreen-keys')

  await press('Escape')
  check('Esc closes fullscreen', !(await exists('.fs-layer')))

  // Oturumu uygulamadan kapat (silme işaretleri diske gitmesin).
  await click('.review-top .btn-ghost.btn-icon', 0)
  await sleep(500)
  if (await exists('.modal .btn-danger')) {
    await click('.modal .btn-danger')
    await sleep(700)
  }
  check('review closed after fullscreen test', !(await exists('.review-screen')))

  const failed = results.filter((entry) => !entry.ok)
  console.log(`[test] ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) console.log('[test] FAILED:', failed.map((entry) => entry.name).join(' | '))
  await sleep(300)
  win.close()
}