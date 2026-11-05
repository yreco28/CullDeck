'use strict'

/* Yeni özellik turu testleri:
   1) Başlık çubuğunda klasör bilgisi yok.
   2) Bozuk kaynak klasör taramada kept kayıtlarını silmez (canlı köklerle budama).
   3) Ayarlar'da bozuk klasör satırı uyarısı + Düzelt butonu.
   4) app:replace-root kept/meta/oturum yollarını taşır, ayarları günceller.
   5) Aynı moddan ikinci oturum: onay sorulur; "öncekini sonlandır" / "yeni oturum".
   6) İncelemede toplu seçim: tümünü seç / tut (anında kalıcı) / sil (işaretleme).
   7) Galeride albüm açıkken "Klasörü Aç" düğmesi görünüyor. */

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function runTest(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const clickText = (text, selector = 'button') =>
    js(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => (b.textContent || '').includes(${JSON.stringify(text)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const clickExact = (text, selector = 'button') =>
    js(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => (b.textContent || '').trim() === ${JSON.stringify(text)}); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const clickSel = (selector) =>
    js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'MISS'; el.click(); return 'OK' })()`)
  const clickNth = (selector, index) =>
    js(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return 'MISS'; el.click(); return 'OK' })()`)
  const count = (selector) => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const waitFor = async (fn, timeout = 30000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      try {
        if (await fn()) return true
      } catch {
        /* navigation */
      }
      await sleep(150)
    }
    return false
  }
  const waitHome = () => waitFor(() => exists('.home-ready'), 40000)
  const waitReview = () => waitFor(() => exists('.review-screen'), 20000)
  const sessionList = () => js(`window.api.reviewSessions().then((l) => JSON.stringify(l))`).then((raw) => JSON.parse(raw))
  const setRoots = async (list) => {
    await js(`window.api.saveSettings({ rootFolders: ${JSON.stringify(list)} })`)
    win.webContents.reload()
    return waitHome()
  }

  const shotDir = path.join(dir, '..')
  const roots = {
    photos: path.join(shotDir, 'photos'),
    gone: path.join(shotDir, 'photos-gone'),
    fixed: path.join(shotDir, 'photos-fixed'),
    missing: path.join(shotDir, 'photos-missing'),
    photos2: path.join(shotDir, 'photos2')
  }
  const keptFile = () => path.join(shotDir, 'userdata', 'kept.json')
  const readKept = async () => {
    try {
      return Object.keys(JSON.parse(await fsp.readFile(keptFile(), 'utf8')))
    } catch {
      return []
    }
  }

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  /* ---- 1) Başlık çubuğunda klasör bilgisi yok ---- */
  check('home ready', await waitHome())
  check('titlebar has no folder info', !(await exists('.titlebar-folder')))

  /* ---- 2) kept koruma: bozuk kök taramada kept'i silmez ---- */
  const goneFileA = path.join(roots.gone, 'gone_a.jpg')
  const goneFileB = path.join(roots.gone, 'gone_b.jpg')
  await fsp.mkdir(roots.gone, { recursive: true })
  await fsp.copyFile(path.join(roots.photos, 'A', 'img_0003.jpg'), goneFileA)
  await fsp.copyFile(path.join(roots.photos, 'A', 'img_0004.jpg'), goneFileB)
  await js(`window.api.saveSettings({ rootFolders: ${JSON.stringify([roots.photos, roots.gone])} })`)
  await js(`window.api.setKept(${JSON.stringify([goneFileA, goneFileB])}, true)`)
  await sleep(700)
  const keptBefore = await readKept()
  check('kept seeded (2 entries)', keptBefore.length === 2, JSON.stringify(keptBefore))

  // Klasör yeniden adlandırılır -> eski kök yolu bozuk hâle gelir.
  await fsp.rm(roots.fixed, { recursive: true, force: true })
  await fsp.rename(roots.gone, roots.fixed)
  // Reload -> açılış taraması [photos, gone] köklerini sessizce tarar.
  check('home ready (missing root kept)', await waitHome())
  await sleep(1200)
  const keptAfterScan = await readKept()
  const keptHold =
    keptBefore.length > 0 &&
    keptBefore.every((entry) => keptAfterScan.some((kept) => kept.toLowerCase() === entry.toLowerCase()))
  check('rescan with broken root keeps kept records', keptHold, `${keptBefore.length} -> ${keptAfterScan.length}`)

  /* ---- 3) replace-root: kayıtları yeni yola taşır ---- */
  const replaced = JSON.parse(
    await js(
      `window.api.replaceRoot(${JSON.stringify(roots.gone)}, ${JSON.stringify(roots.fixed)}).then((r) => JSON.stringify({ kept: r.kept, moved: r.moved, roots: r.settings.rootFolders }))`
    )
  )
  const keptNow = await readKept()
  const movedKeptCount = keptNow.filter((entry) => entry.toLowerCase().startsWith(roots.fixed.toLowerCase())).length
  check('replace-root updates settings root', (replaced.roots || []).some((root) => root === roots.fixed), JSON.stringify(replaced.roots))
  check('replace-root moves kept paths to new root', movedKeptCount === 2, `count=${movedKeptCount}`)
  check('old root kept entries are gone', !keptNow.some((entry) => entry.toLowerCase().startsWith(roots.gone.toLowerCase())))

  /* ---- 4) Ayarlar: bozuk klasör satırı + Düzelt ---- */
  // Gerçekten kayıp klasör (klasör hiç oluşturulmadı).
  await fsp.rm(roots.missing, { recursive: true, force: true })
  check('broken row: home ready', await setRoots([roots.photos, roots.missing]))
  await clickText('Ayarlar', 'button')
  await waitFor(() => exists('.folder-list'), 8000)
  check('broken folder row marked', await exists('.folder-row.is-broken'))
  check('Düzelt button visible', await exists('.folder-fix'))
  const rowText = await js(`(document.querySelector('.folder-row.is-broken')?.textContent || '')`)
  check('broken row shows warning text', rowText.includes('bulunamadı'), `(${rowText.slice(0, 160)})`)
  check('healthy rows not marked broken', (await count('.folder-row.is-broken')) === 1)
  check('healthy home returns', await setRoots([roots.photos, roots.fixed]))

  /* ---- 5) Çoklu oturum: aynı moddan ikinci oturum onay ister ---- */
  const screenState = () =>
    js(`(() => JSON.stringify({ modal: !!document.querySelector('.session-choice-actions'), review: !!document.querySelector('.review-screen'), bar: !!document.querySelector('.select-bar'), home: !!document.querySelector('.home-ready') }))()`).then(
      (raw) => JSON.parse(raw)
    )

  const startRandom = async () => {
    await waitHome()
    const homeClick = await clickText('Rastgele', '.mode-card')
    if (homeClick === 'MISS') return { state: 'miss', why: 'mode-card click MISS' }
    // Seçim ekranı açılsın; başlat düğmesi etkinleşince tıkla.
    const ready = await waitFor(
      () =>
        js(
          `(() => { const b = document.querySelector('.select-bar .btn-primary'); return !!(b && !b.disabled && (b.textContent || '').includes('öğeyi incele')) })()`
        ),
      12000
    )
    const readyState = await screenState()
    if (!ready) {
      return { state: 'miss', why: `select-bar not ready ${JSON.stringify(readyState)}` }
    }
    if (readyState.review) return { state: 'review' }
    if (readyState.modal) return { state: 'conflict' }
    await clickSel('.select-bar .btn-primary')
    const decisionReady = await waitFor(
      () => screenState().then((s) => s.review || s.modal),
      20000
    )
    const after = await screenState()
    if (!decisionReady) {
      return { state: 'miss', why: `no decision ${JSON.stringify(after)} toasts=${await js(`[...document.querySelectorAll('.toast')].map(e=>e.textContent).join('|')`)}` }
    }
    if (after.modal) return { state: 'conflict' }
    return { state: 'review' }
  }

  const first = await startRandom()
  check('first random session opened without asking', first.state === 'review', `state=${first.state} why=${first.why || ''}`)
  // Duraklat + kaydet.
  check('pause button present', (await clickSel('.pause-btn')) === 'OK')
  await waitFor(() => exists('.home-ready'), 15000)
  await sleep(800)
  let list = await sessionList()
  const randomBefore = list.filter((entry) => entry.mode === 'random')
  check('saved random session exists', randomBefore.length === 1, `n=${randomBefore.length}`)

  const second = await startRandom()
  check('conflict modal asks for choice', second.state === 'conflict', `state=${second.state}`)
  check('still not reviewing during choice', !(await exists('.review-screen')))
  await clickText('Yeni bir oturum olarak başlat', 'button')
  check('second session opened', await waitReview())
  await sleep(900)
  list = await sessionList()
  const randomTwo = list.filter((entry) => entry.mode === 'random')
  check('two random sessions coexist', randomTwo.length === 2, `n=${randomTwo.length}`)
  check(
    'second session carries sessionId',
    randomTwo.filter((entry) => !!entry.sessionId).length === 1,
    JSON.stringify(randomTwo.map((entry) => entry.sessionId))
  )
  check('pause button present (second)', (await clickSel('.pause-btn')) === 'OK')
  await waitFor(() => exists('.home-ready'), 15000)
  await sleep(600)

  // "Öncekini sonlandır ve başlat": kayıtlı oturumlar silinir.
  const third = await startRandom()
  check('conflict modal appears again', third.state === 'conflict', `state=${third.state}`)
  await clickText('Öncekilerini sonlandır', 'button')
  check('third session opened after end choice', await waitReview())
  await sleep(900)
  list = await sessionList()
  const randomAfter = list.filter((entry) => entry.mode === 'random')
  check('previous sessions ended by choice', randomAfter.length === 1, `n=${randomAfter.length}`)

  /* ---- 6) Toplu seçim: tümünü seç + tut (anında kalıcı) ---- */
  check('bulk toggle works', (await clickSel('.review-top .btn[title="Toplu seçim"]')) === 'OK')
  check('bulk bar appears', await exists('.bulk-bar'))
  await sleep(400)
  const totalThumbs = await count('.strip-thumb')
  check('random session has reviewable items', totalThumbs > 0, `total=${totalThumbs}`)
  await clickNth('.strip-thumb', 0)
  await clickNth('.strip-thumb', 1)
  await sleep(150)
  check('strip click toggles selection', (await count('.strip-thumb.picked')) === 2)
  await clickText('Tümünü seç', 'button')
  await sleep(150)
  const pickedAll = await count('.strip-thumb.picked')
  check('select all picks every thumb', pickedAll === totalThumbs, `${pickedAll}/${totalThumbs}`)
  const keptBeforeBulk = (await readKept()).length
  await clickText('Tut', '.bulk-bar button')
  await sleep(1000)
  check('bulk keep marks every item', (await count('.strip-mark.keep')) === totalThumbs, `marks=${await count('.strip-mark.keep')}/${totalThumbs}`)
  const keptAfterBulk = (await readKept()).length
  check('bulk keep persists to kept.json', keptAfterBulk >= keptBeforeBulk + totalThumbs, `${keptBeforeBulk} -> ${keptAfterBulk}`)
  list = await sessionList()
  check('fully kept session cleared from list', list.filter((entry) => entry.mode === 'random').length === 0, `n=${list.length}`)
  await waitFor(() => exists('.home-ready'), 15000)

  /* ---- 7) Toplu sil + galeri Klasörü Aç ---- */
  // Yeni kök ekle: kept olmayan taze öğeler toplu sil testi için.
  check('photos2 root ready', await setRoots([roots.photos2]))
  await clickText('Galeri', 'button')
  await waitFor(() => exists('.album-card'), 12000)
  check('open-folder button hidden while albums shown', !(await exists('[title="Klasörü aç"]')))
  await clickNth('.album-card', 0)
  await waitFor(() => exists('.tile'), 12000)
  check('gallery shows open folder button inside album', await exists('[title="Klasörü aç"]'))
  // Seçim modu + toplu sil
  check('select mode button', (await clickExact('Seç')) === 'OK')
  await waitFor(() => exists('.select-toolbar'), 6000)
  await clickNth('.tile', 0)
  await clickNth('.tile', 1)
  await clickNth('.tile', 2)
  await clickText('Seçilenleri incele', 'button')
  check('gallery review session opened', await waitReview())
  check('bulk toggle works (delete test)', (await clickSel('.review-top .btn[title="Toplu seçim"]')) === 'OK')
  await waitFor(() => exists('.bulk-bar'), 5000)
  await clickText('Tümünü seç', 'button')
  const galleryTotal = await count('.strip-thumb')
  check('gallery review has 3 items', galleryTotal === 3, `${galleryTotal}`)
  await clickText('Sil', '.bulk-bar button')
  await sleep(250)
  const deleteMarks = await count('.strip-mark.delete')
  const keepMarks2 = await count('.strip-mark.keep')
  check('bulk delete marks selection', deleteMarks === galleryTotal && galleryTotal === 3, `marks=${deleteMarks}/${galleryTotal}`)
  check('bulk delete does not keep', keepMarks2 === 0)

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[features6] ${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
  await sleep(300)
  win.close()
}
