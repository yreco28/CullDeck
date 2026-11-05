'use strict'

// README ekran görüntüleri: seçim ekranında albüm seçip incelemeyi başlatır.
// Kullanım: SPONGE_SHOT_DIR + SPONGE_SHOT_SCRIPT + SPONGE_SHOT_LANG=tr|en

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const TEXT = {
  tr: {
    gallery: 'Galeri',
    clean: 'Temizle',
    albumMode: 'Albüme göre',
    selectAll: 'Tümünü seç',
    home: 'Ana sayfa',
    stats: 'İstatistikler',
    settings: 'Ayarlar',
    light: 'Açık',
    dark: 'Koyu'
  },
  en: {
    gallery: 'Gallery',
    clean: 'Clean',
    albumMode: 'By album',
    selectAll: 'Select all',
    home: 'Home',
    stats: 'Statistics',
    settings: 'Settings',
    light: 'Light',
    dark: 'Dark'
  }
}

module.exports = async function runShots(win, dir) {
  const lang = process.env.SPONGE_SHOT_LANG === 'en' ? 'en' : 'tr'
  const text = TEXT[lang]
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    await sleep(550)
    const image = await win.capturePage()
    await fsp.writeFile(path.join(dir, `${name}.png`), image.toPNG())
    console.log('[shot]', name)
  }
  const click = (selector, index = 0) =>
    js(
      `(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = list[${index}]; if (!el) return 'MISS'; el.click(); return 'OK:' + list.length })()`
    )
  const clickText = (value, selector = 'button') =>
    js(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => (b.textContent || '').includes(${JSON.stringify(value)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const log = (message) => console.log('[step]', message)
  const waitFor = async (selector, timeout = 15000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await exists(selector)) return true
      await sleep(150)
    }
    return false
  }

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 2) console.log('[renderer-error]', event.message)
  })

  // taranın bitmesini bekle
  for (let i = 0; i < 60; i += 1) {
    if (await exists('.folder-count')) break
    await sleep(400)
  }
  await shot('01-home')

  log(await clickText(text.gallery))
  await sleep(1600)
  await shot('02-gallery')

  log(await click('.album-card'))
  await sleep(1400)
  await shot('03-album')

  log(await click('.tile'))
  await sleep(900)
  await shot('04-zoom')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await sleep(500)

  log(await clickText(text.clean))
  await sleep(800)

  log(await clickText(text.albumMode, '.mode-card'))
  await sleep(800)
  await waitFor('.group-row')
  log(await clickText(text.selectAll))
  await sleep(500)
  await shot('05-select')

  // albüm seçildikten sonra incelemeyi başlat
  log(await click('.select-bar .btn-primary'))
  await waitFor('.round-btn.keep')
  await sleep(900)
  await shot('06-review')

  log(await click('.round-btn.keep'))
  await sleep(850)
  log(await click('.round-btn.keep'))
  await sleep(850)
  await shot('07-review-progress')

  log(await click('.round-btn.delete'))
  await sleep(700)
  log(await click('.round-btn.delete'))
  await sleep(700)
  log(await click('.round-btn.delete'))
  await sleep(700)

  // kalanları atla, özete ulaş
  for (let i = 0; i < 80; i += 1) {
    if (await exists('.summary-actions')) break
    await click('.round-btn.small', 1)
    await sleep(220)
  }
  await waitFor('.summary-actions')
  await sleep(700)
  await shot('08-summary')

  // özet kartındaki silme butonu hazır olunca uygula
  for (let i = 0; i < 40; i += 1) {
    const ready = await js(
      `(() => { const b = document.querySelector('.summary-actions .btn-danger'); return Boolean(b) && !b.disabled })()`
    )
    if (ready) break
    await sleep(250)
  }
  log(await click('.summary-actions .btn-danger'))
  await waitFor('.done-card', 30000)
  await sleep(1400)
  await shot('09-done')

  log(await clickText(text.home))
  await sleep(1200)

  log(await clickText(text.stats))
  await sleep(1200)
  await shot('10-stats')

  log(await clickText(text.settings))
  await sleep(1000)
  await shot('11-settings')

  // açık tema
  log(await clickText(text.light, '.segmented button'))
  await sleep(800)
  await shot('12-settings-light')

  log(await clickText(text.dark, '.segmented button'))
  await sleep(600)

  log(await clickText(text.gallery))
  await sleep(1400)
  await shot('13-gallery-after')

  log(await clickText(text.clean))
  await sleep(900)
  await shot('14-home-after')

  console.log('[shots] tamam')
  await sleep(300)
  win.close()
}
