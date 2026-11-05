'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function runShots(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    await sleep(500)
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
  const log = (message) => console.log('[step]', message)

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 2) console.log('[renderer-error]', event.message)
  })

  // taranın bitmesini bekle
  for (let i = 0; i < 60; i += 1) {
    if (await exists('.folder-count')) break
    await sleep(400)
  }
  await shot('01-home')

  log(await clickText('Galeri'))
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

  log(await clickText('Temizle'))
  await sleep(700)

  log(await clickText('Albüme göre', '.mode-card'))
  await sleep(700)
  await shot('05-select')

  log(await clickText('incele'))
  await sleep(1400)
  await shot('06-review')

  log(await click('.round-btn.keep'))
  await sleep(900)
  log(await click('.round-btn.keep'))
  await sleep(900)
  await shot('07-review-progress')

  log(await click('.round-btn.delete'))
  await sleep(900)
  log(await click('.round-btn.delete'))
  await sleep(900)
  log(await click('.round-btn.delete'))
  await sleep(900)

  for (let i = 0; i < 40; i += 1) {
    if (await exists('.summary-card')) break
    await click('.round-btn.small', 1)
    await sleep(420)
  }
  await sleep(900)
  await shot('08-summary')

  log(await clickText('çöp kutusuna taşı'))
  await sleep(2400)
  await shot('09-done')

  log(await clickText('Ana sayfa'))
  await sleep(900)

  log(await clickText('İstatistikler'))
  await sleep(1000)
  await shot('10-stats')

  log(await clickText('Ayarlar'))
  await sleep(900)
  await shot('11-settings')

  // açık tema
  log(await clickText('Açık', '.segmented button'))
  await sleep(700)
  await shot('12-settings-light')

  log(await clickText('Koyu', '.segmented button'))
  await sleep(500)

  log(await clickText('Galeri'))
  await sleep(1200)
  await shot('13-gallery-after')

  log(await clickText('Temizle'))
  await sleep(800)
  await shot('14-home-after')

  console.log('[shots] tamam')
  await sleep(300)
  win.close()
}
