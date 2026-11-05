'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Bozuk bir video dosyası silinebiliyor mu? */
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

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  check('home ready', await waitHome())
  await waitFor(async () => (await clickText('Temizlemeye başla')) !== 'MISS', 10000)
  check('group list ready', await waitFor(() => exists('.group-row'), 15000))
  check('broken group selected', (await clickGroup('C')) !== 'MISS')
  await sleep(500)
  await clickText('incele', '.select-bar .btn-primary')
  check('broken review opened', await waitReview())
  await shot('d1-broken-review')

  await click('.round-btn.delete')
  await sleep(900)
  await click('.pause-btn')
  await sleep(700)
  check('pause modal opened', await exists('.pause-modal'))
  await clickText('Çöp kutusuna taşı', '.pause-actions .btn')
  check('done summary shown', await waitFor(() => exists('.done-card'), 20000))
  const done = await text('.done-card')
  check('broken file reported deleted', /1\s*Silindi/.test(done), done.replace(/\s+/g, ' ').slice(0, 200))
  check('no failed item', !done.includes('işlenemedi'), done.replace(/\s+/g, ' ').slice(0, 200))
  check('broken file gone from disk', await fsp.access(path.join(dir, '..', 'photos', 'C', 'broken.mp4')).then(() => false).catch(() => true))
  await shot('d2-broken-delete-result')

  /* ---- 2. Oynatılan (kilitli olabilecek) videoyu da silebilmeli ---- */
  await click('.done-actions .btn-primary')
  check('remaining session reopens', await waitReview())
  check(
    'remaining video playing',
    await waitFor(async () => js(`(() => { const v = document.querySelector('.stage-video video'); return Boolean(v && !v.paused) })()`), 20000)
  )
  await click('.round-btn.delete')
  await sleep(900)
  check('finished summary for last video', await exists('.summary-card'))
  await click('.summary-actions .btn-danger')
  check('playable video done summary', await waitFor(() => exists('.done-card'), 20000))
  const lastDone = await text('.done-card')
  check('playable video reported deleted', /1\s*Silindi/.test(lastDone), lastDone.replace(/\s+/g, ' ').slice(0, 200))
  check('playable video no failed item', !lastDone.includes('işlenemedi'), lastDone.replace(/\s+/g, ' ').slice(0, 200))
  check(
    'playable video gone from disk',
    await fsp.access(path.join(dir, '..', 'photos', 'C', 'zzz-ok.mp4')).then(() => false).catch(() => true)
  )
  await shot('d3-playable-delete-result')

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[test] ${passed}/${results.length} passed`)
  if (passed !== results.length) console.log('[test] FAILED:', results.filter((entry) => !entry.ok).map((entry) => entry.name).join(' | '))
  await sleep(300)
  win.close()
}
