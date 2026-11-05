'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function runTest(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    await sleep(450)
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
  const text = (selector) => js(`(document.querySelector(${JSON.stringify(selector)})?.textContent || '')`)
  const count = (selector) => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
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
    waitFor(() => exists('.home-ready'), 40000)
  const waitReview = () => waitFor(() => exists('.strip-thumb'), 15000)

  // Klasör seçim ekranı varsayılan olarak boş: "Tümünü seç" ile hepsini seçip incelemeye başla.
  const startReviewAll = async (label = 'album') => {
    await clickText('Temizlemeye başla')
    await sleep(700)
    await clickText('Tümünü seç', '.bulk-tools .btn')
    await sleep(450)
    await clickText('incele', '.select-bar .btn-primary')
    // Çoklu oturum özelliği: aynı moddan kayıtlı oturum varsa onay penceresi çıkar.
    if (await exists('.session-choice-actions')) {
      console.log('[test] conflict modal -> end previous')
      await clickText('Öncekilerini sonlandır', '.session-choice-actions .btn')
      await sleep(400)
    }
    return waitReview()
  }

  // Tek bir albüm/klasör grubunu seçerek incelemeye başla.
  const clickGroup = (name) =>
    js(
      `(() => { const el = [...document.querySelectorAll('.group-row')].find(r => ((r.querySelector('.group-name')?.textContent) || '').trim() === ${JSON.stringify(name)}); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const startReviewGroup = async (name) => {
    await clickText('Temizlemeye başla')
    await sleep(700)
    const picked = await clickGroup(name)
    if (picked === 'MISS') return false
    await sleep(400)
    await clickText('incele', '.select-bar .btn-primary')
    return waitReview()
  }

  const folders = (list) => js(`window.api.saveSettings({ rootFolders: ${JSON.stringify(list)} })`)
  const folderNamesFromStrip = () =>
    js(`[...document.querySelectorAll('.strip-thumb')].map(t => (t.getAttribute('title')||'').split(' · ').slice(1).join(' · '))`)

  const photos = path.join(dir, '..', 'photos')
  const photos2 = path.join(dir, '..', 'photos2')

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }
  const boot = await js('window.api.bootstrap()')
  console.log('[test] userData =', boot.userData)

  /* ---- 1. home + scan ---- */
  check('home scan finished', await waitHome())
  check('home folder card removed', !(await exists('.folder-card')))
  check(
    'home folder section removed',
    await js(`![...document.querySelectorAll('.section-title')].some(e => (e.textContent||'').includes('Fotoğraf klasörleri'))`)
  )
  await shot('01-home')

  /* ---- 2. select screen starts empty, manual selection ---- */
  await clickText('Temizlemeye başla')
  await sleep(700)
  const defaultSelected = await count('.group-row.selected')
  check('folder selection starts empty', defaultSelected === 0, `(${defaultSelected})`)
  check('review button disabled without selection', await js(`document.querySelector('.select-bar .btn-primary')?.disabled === true`))
  await shot('02a-select-empty')
  await clickText('Tümünü seç', '.bulk-tools .btn')
  await sleep(450)
  const selectedAfterAll = await count('.group-row.selected')
  check('select all selects groups', selectedAfterAll > 0, `(${selectedAfterAll})`)
  await clickText('Hiçbirini seçme', '.bulk-tools .btn')
  await sleep(350)
  const pickedGroup = await clickGroup('A')
  check('single folder can be selected', pickedGroup === 'OK')
  await sleep(350)
  const selectedOne = await count('.group-row.selected')
  check('only one folder selected', selectedOne === 1, `(${selectedOne})`)
  await clickText('incele', '.select-bar .btn-primary')
  check('review opened', await waitReview())
  const stripCount = await count('.strip-thumb')
  check('strip has 20 items (folder A only)', stripCount === 20, `(${stripCount})`)
  await shot('02-review')

  // keep, delete, keep
  await click('.round-btn.keep')
  await sleep(600)
  await click('.round-btn.delete')
  await sleep(600)
  await click('.round-btn.keep')
  await sleep(750)
  check('counter advanced', (await text('.review-counter')).includes('4 / 20'), await text('.review-counter'))
  const keptFiles = await js(
    `[...document.querySelectorAll('.strip-thumb.keep')].map(t => (t.getAttribute('title')||'').split(' · ').slice(1).join(' · '))`
  )
  check('two items kept', keptFiles.length === 2, JSON.stringify(keptFiles))
  await shot('03-review-marks')

  /* ---- 3. pause via "Devam et" -> selection modal ---- */
  await click('.pause-btn')
  await sleep(650)
  check('pause modal open', await exists('.pause-modal'))
  const pauseTiles = await count('.pause-tile')
  check('pause modal lists 1 deletion', pauseTiles === 1, `(${pauseTiles})`)
  await shot('04-pause-modal')

  // uncheck then re-check
  await click('.pause-tile')
  await sleep(250)
  const disabledAfterUncheck = await js(
    `(() => { const btns = [...document.querySelectorAll('.pause-actions .btn')]; return btns.slice(1).every(b => b.disabled) })()`
  )
  check('delete buttons disabled when nothing selected', disabledAfterUncheck)
  await click('.pause-tile')
  await sleep(250)

  // decide later: no deletion
  await clickText('Daha sonra karar ver', '.pause-actions .btn')
  await sleep(1000)
  check('paused to home', await exists('.continue-card'))
  check('saved session card for folder', (await count('.saved-session-card')) >= 1, `(${await count('.saved-session-card')})`)
  await shot('05-home-paused')

  /* ---- 4. resume session: kept items must NOT come back ---- */
  await click('.continue-card')
  check('resumed review', await waitReview())
  const resumedCounter = await text('.review-counter')
  check('kept items removed from queue (18 left)', resumedCounter.includes('/ 18'), resumedCounter)
  const resumedFiles = await folderNamesFromStrip()
  check('kept file names gone from strip', keptFiles.every((name) => !resumedFiles.includes(name)), JSON.stringify(keptFiles))
  await shot('05b-resumed-no-kept')
  await sleep(400)

  /* ---- 5. pause with deletion (trash) -> summary ---- */
  await click('.round-btn.delete')
  await sleep(750)
  await click('.pause-btn')
  await sleep(550)
  await shot('06-pause-modal-checked')
  await clickText('Çöp kutusuna taşı', '.pause-actions .btn')
  check('done summary shown', await waitFor(() => exists('.done-card'), 20000))
  const doneChips = await text('.done-chips')
  check(
    'summary reports deletion',
    /\d+\s*Silindi/.test(doneChips) && /\d+\s*Tutuldu/.test(doneChips),
    doneChips.replace(/\s+/g, ' ').slice(0, 120)
  )
  check('summary shows remaining note', await exists('.done-note'))
  await shot('07-done-summary')

  /* ---- 6. done -> continue remaining ---- */
  await clickText('Devam et', '.done-actions .btn')
  check('done resume works', await waitReview())
  const remainingTotal = await text('.review-counter')
  check('remaining session total is 16', remainingTotal.includes('/ 16'), remainingTotal)
  await sleep(700)

  /* ---- 7. two folders -> a session per folder ---- */
  await folders([photos, photos2])
  await sleep(500)
  win.webContents.reload()
  check('two folders scanned', await waitHome())
  check('photos session listed', (await count('.saved-session-card')) >= 1, `(${await count('.saved-session-card')})`)
  await shot('08-home-other-session')

  // create a session that spans both folders, then pause -> splits per folder
  check('two-folder review opened', await startReviewAll())
  await click('.round-btn.keep')
  await sleep(700)
  await click('.round-btn.small', 1)
  await sleep(700)
  await click('.pause-btn')
  check('two-folder review paused', await waitFor(() => exists('.continue-card'), 8000))
  check('one card per folder/subfolder session', (await count('.saved-session-card')) === 3, `(${await count('.saved-session-card')})`)
  await shot('09-home-two-sessions')

  /* ---- 8. continue button lets you choose the folder ---- */
  await click('.continue-card')
  await sleep(500)
  check('resume picker opens with multiple sessions', await exists('.resume-picker'))
  const options = await count('.resume-option')
  check('picker lists every folder session', options === 3, `(${options})`)
  await shot('10-resume-picker')
  await click('.resume-option')
  check('picking a folder resumes its session', await waitReview())
  await sleep(500)

  /* ---- 9. removing a folder drops its session; resume restores nothing ---- */
  await clickText('Temizle', '.nav-item')
  await sleep(600)
  const sessionsBefore = await count('.saved-session-card')
  check('three folder sessions before removal', sessionsBefore === 3, `(${sessionsBefore})`)
  await folders([photos])
  await sleep(600)
  win.webContents.reload()
  check('single folder back', await waitHome())
  const afterRemove = await count('.saved-session-card')
  check('removed folder session is gone', afterRemove === 2, `(${afterRemove})`)
  const rootAfter = await js('(async () => (await window.api.bootstrap()).settings.rootFolders)()')
  check('resume does not restore removed folders', rootAfter.length === 1 && rootAfter[0].toLowerCase().endsWith('photos'), JSON.stringify(rootAfter))
  await shot('11-home-after-remove')

  // continue card must resume without resurrecting folders
  if (await exists('.continue-card')) {
    await click('.continue-card')
    await sleep(500)
    if (await exists('.resume-picker')) await click('.resume-option')
    check('continue opens a saved session after removal', await waitReview())
    await sleep(500)
    const rootsWhileReview = await js('(async () => (await window.api.bootstrap()).settings.rootFolders)()')
    check('resuming keeps folder list unchanged', rootsWhileReview.length === 1, JSON.stringify(rootsWhileReview))
    await clickText('Temizle', '.nav-item')
    await sleep(500)
  }

  /* ---- 10. no folders -> no sessions ---- */
  await js('window.api.saveSettings({ rootFolders: [] })')
  await sleep(500)
  win.webContents.reload()
  await sleep(1500)
  check('start disabled without folders', await js(`document.querySelector('.hero-actions .btn-primary')?.disabled === true`))
  check('no saved sessions without folders', (await count('.saved-session-card')) === 0, `(${await count('.saved-session-card')})`)
  check('no continue card without folders', !(await exists('.continue-card')))
  await shot('12-home-no-sessions')

  /* ---- 11. gallery search + sort/filter + keyboard ---- */
  await folders([photos, photos2])
  await sleep(500)
  win.webContents.reload()
  check('folders back for gallery', await waitHome())
  await clickText('Galeri', '.nav-item')
  await sleep(900)
  await js(`(() => {
    const input = document.querySelector('.search-field input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'img');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await sleep(700)
  const searchTiles = await count('.tile')
  check('search "img" matches IMG_ files', searchTiles > 0, `(${searchTiles})`)
  check('sort control exists', await exists('.mini-field select'))
  await shot('13-gallery-search')
  await js(`(() => { const input = document.querySelector('.search-field input'); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await sleep(600)
  await click('.album-card')
  await sleep(700)
  // Ctrl+A select all
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
  await sleep(600)
  check('Ctrl+A enters selection', await exists('.select-toolbar'))
  check('review selected button exists', await js(`[...document.querySelectorAll('.select-toolbar .btn')].some(b => (b.textContent||'').includes('Seçilenleri incele'))`))
  await shot('14-gallery-select')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await sleep(400)

  /* ---- 12. settings cache card ---- */
  await clickText('Ayarlar', '.nav-item')
  await sleep(800)
  check('cache card exists', await js(`[...document.querySelectorAll('.settings-card')].some(c => (c.textContent||'').includes('Önbellek'))`))
  check('clear cache button exists', await js(`[...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('Önbelleği temizle'))`))
  await shot('15-settings-cache')

  /* ---- 13. big library performance ---- */
  const big = path.join(dir, '..', 'big')
  await folders([big])
  await sleep(600)
  const scanStart = Date.now()
  win.webContents.reload()
  check('big folder scanned+cached', await waitHome(), `${Date.now() - scanStart}ms`)
  await shot('16-big-home')
  const reviewStart = Date.now()
  check('1100 item review opens', await startReviewAll(), `${Date.now() - reviewStart}ms`)
  const bigStrip = await count('.strip-thumb')
  check('strip renders only a window of 1100 items', bigStrip > 0 && bigStrip < 200, `(${bigStrip})`)
  await sleep(1500)
  await shot('17-big-review')
  const loadedThumbs = await count('.strip-thumb img')
  check('lazy strip thumbs only load visible ones', loadedThumbs > 0 && loadedThumbs < 200, `(${loadedThumbs} loaded)`)

  const failed = results.filter((entry) => !entry.ok)
  console.log(`[test] ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) console.log('[test] FAILED:', failed.map((entry) => entry.name).join(' | '))
  await sleep(300)
  win.close()
}
