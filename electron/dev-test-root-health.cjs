'use strict'

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
  const bannerText = () => js(`(document.querySelector('.root-warning')?.textContent || '')`)
  const toasts = () =>
    js(`[...document.querySelectorAll('.toast')].map((el) => el.textContent.trim())`)

  const photos = path.join(dir, '..', 'photos')
  const missing = path.join(dir, '..', 'photos-gone')
  const empty = path.join(dir, '..', 'photos-empty')

  await fsp.rm(missing, { recursive: true, force: true })
  await fsp.rm(empty, { recursive: true, force: true })
  await fsp.mkdir(empty, { recursive: true })

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  // 1) Açılış: kaynak klasör diskte yok -> uyarı olmalı (tarama sessiz olsa bile).
  await js(`window.api.saveSettings({ rootFolders: ${JSON.stringify([photos, missing])} })`)
  await sleep(400)
  win.webContents.reload()
  check('home ready (missing root)', await waitHome())
  const warned = await waitFor(async () => (await bannerText()).includes('bulunamadı'), 30000)
  check('startup warning banner for missing root', warned, `(${await bannerText()})`)
  const startupToasts = await toasts()
  check(
    'startup toast names the missing folder',
    startupToasts.some((text) => text.includes('bulunamadı') && text.includes('photos-gone')),
    JSON.stringify(startupToasts)
  )
  const scanned = await js(`(document.querySelector('.hero-stat-value')?.textContent || '')`)
  check('healthy root still scanned', scanned && scanned !== '0', `(${scanned})`)

  // 2) Klasör geri gelir + içine medya konur -> manuel tarama uyarıyı kaldırmalı.
  await fsp.mkdir(missing, { recursive: true })
  await fsp.copyFile(path.join(photos, 'A', 'img_0002.jpg'), path.join(missing, 'recovered_0001.jpg'))
  await clickText('Ayarlar', 'button')
  await waitFor(() => exists('.folder-list'), 8000)
  await clickText('Yeniden tara')
  const rescanned = await waitFor(async () => (await toasts()).some((text) => text.includes('tarandı')), 40000)
  check('manual rescan completed', rescanned, JSON.stringify(await toasts()))
  await clickText('Temizle', 'button')
  await waitFor(() => exists('.home-ready'), 15000)
  const cleared = !(await exists('.root-warning'))
  check('warning cleared after manual rescan', cleared, `(${await bannerText()})`)
  const rescanToasts = await toasts()
  check(
    'manual rescan reports scanned items',
    rescanToasts.some((text) => text.includes('tarandı')),
    JSON.stringify(rescanToasts)
  )

  // 3) Erişilebilir ama medyasız klasör -> ayrı uyarı.
  await js(`window.api.saveSettings({ rootFolders: ${JSON.stringify([photos, empty])} })`)
  await sleep(400)
  win.webContents.reload()
  check('home ready (empty root)', await waitHome())
  const emptyWarned = await waitFor(async () => (await bannerText()).includes('medya bulunamadı'), 30000)
  check('empty folder warning banner', emptyWarned, `(${await bannerText()})`)
  const emptyToasts = await toasts()
  check(
    'empty folder warning toast',
    emptyToasts.some((text) => text.includes('medya bulunamadı') && text.includes('photos-empty')),
    JSON.stringify(emptyToasts)
  )

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[root-health] ${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
  await sleep(300)
  win.close()
}
