'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function runTest(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const click = (selector, index = 0) =>
    js(
      `(() => { const list = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = list[${index}]; if (!el) return 'MISS'; el.click(); return 'OK:' + list.length })()`
    )
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
      await sleep(200)
    }
    return false
  }
  const waitHome = () => waitFor(() => exists('.home-ready'), 40000)
  const waitReview = () => waitFor(() => exists('.strip-thumb'), 20000)
  const barPct = () =>
    js(
      `(() => { const track = document.querySelector('.review-progress'); const bar = track?.querySelector('.bar'); if (!track || !bar) return -1; return Math.round((bar.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100) })()`
    )
  const barDebug = () =>
    js(
      `(() => { const track = document.querySelector('.review-progress'); const bar = track?.querySelector('.bar'); if (!track || !bar) return null; return { inline: bar.getAttribute('style'), width: bar.style.width, computed: getComputedStyle(bar).width, rect: bar.getBoundingClientRect().width, track: track.getBoundingClientRect().width } })()`
    )
  const counter = () => js(`(document.querySelector('.review-counter')?.textContent || '')`)
  const marks = () =>
    js(`(() => { const out = { keep: 0, delete: 0, skip: 0 }; for (const el of document.querySelectorAll('.strip-thumb')) { if (el.classList.contains('keep')) out.keep += 1; else if (el.classList.contains('delete')) out.delete += 1; else if (el.classList.contains('skip')) out.skip += 1; } return out })()`)

  const photos = path.join(dir, '..', 'photos')
  const photos2 = path.join(dir, '..', 'photos2')
  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  await js(`window.api.saveSettings({ rootFolders: ${JSON.stringify([photos, photos2])} })`)
  await sleep(400)
  win.webContents.reload()
  check('home ready', await waitHome())

  await clickText('Temizlemeye başla')
  await sleep(700)
  await clickText('Tümünü seç', '.bulk-tools .btn')
  await sleep(400)
  await clickText('incele', '.select-bar .btn-primary')
  check('review opened', await waitReview())
  check('start bar 0%', (await barPct()) === 0, `(${await barPct()}%)`)

  let keeps = 0
  for (let attempt = 1; attempt <= 80 && keeps < 49; attempt += 1) {
    await click('.round-btn.keep')
    await sleep(380)
    const m = await marks()
    keeps = m.keep
    if (attempt % 7 === 0) {
      console.log(`[live] after ${keeps} keeps: counter=${await counter()} bar=${await barPct()}% marks=${JSON.stringify(m)} debug=${JSON.stringify(await barDebug())}`)
    }
  }
  await sleep(1200)
  const finalMarks = await marks()
  const finalBar = await barPct()
  console.log('[live] final', await counter(), `${finalBar}%`, JSON.stringify(finalMarks), JSON.stringify(await barDebug()))
  check('49 keep marks visible', finalMarks.keep === 49, JSON.stringify(finalMarks))
  check('bar reflects 49/50 = 98%', Math.abs(finalBar - 98) <= 1, `(${finalBar}%)`)

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[live] ${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
  await sleep(300)
  win.close()
}
