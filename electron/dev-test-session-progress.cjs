'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Kayıtlı oturum ilerleme çubuğu:
 *  - oturum ilk açıldığı andaki öğe sayısı (initialTotal) kalıcıdır,
 *  - ilerleme (initialTotal - kalan) / initialTotal üzerinden hesaplanır,
 *  - oturum kapatılıp yeniden açıldığında başlangıç sayısı sıfırlanmaz.
 */
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
  const texts = (selector) =>
    js(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => (el.textContent || '').trim())`)
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
  const waitHome = () => waitFor(() => exists('.home-ready'), 40000)
  const waitReview = () => waitFor(() => exists('.strip-thumb'), 15000)
  const counterText = () => text('.review-counter')
  const clickGroup = (name) =>
    js(
      `(() => { const el = [...document.querySelectorAll('.group-row')].find(r => ((r.querySelector('.group-name')?.textContent) || '').trim() === ${JSON.stringify(name)}); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const meterWidth = () =>
    js(
      `(() => { const el = document.querySelector('.saved-session-meter > span'); return el ? Math.round(parseFloat(el.style.width) || 0) : -1 })()`
    )
  const reviewCount = async (times) => {
    for (let index = 0; index < times; index += 1) {
      await click('.round-btn.keep')
      await sleep(650)
    }
  }
  const savedReviewTotals = async () => {
    const file = path.join(dir, '..', 'userdata', 'reviews.json')
    const stored = JSON.parse(await fsp.readFile(file, 'utf8'))
    return Object.values(stored || {})
      .map((entry) => Number(entry?.review?.initialTotal) || 0)
      .filter(Boolean)
  }

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  check('home ready', await waitHome())
  check('no saved sessions yet', (await count('.saved-session-row')) === 0, `(${await count('.saved-session-row')})`)

  /* ---- 1. 20 öğelik oturum aç, 2 öğeyi tut, "Devam et" ile kapat ---- */
  await clickText('Temizlemeye başla')
  await sleep(700)
  check('folder A selected', (await clickGroup('A')) === 'OK')
  await sleep(400)
  await clickText('incele', '.select-bar .btn-primary')
  check('review opened', await waitReview())
  check('session starts at 1 / 20', (await counterText()).includes('1 / 20'), await counterText())
  await reviewCount(2)
  check('counter at 3 / 20', (await counterText()).includes('3 / 20'), await counterText())

  await click('.pause-btn')
  check('paused to home', await waitFor(() => exists('.continue-card'), 10000))
  await sleep(900)

  const sub1 = await texts('.saved-session-sub')
  const count1 = await text('.continue-count')
  const pct1 = await meterWidth()
  check('remaining count is 18', sub1[0]?.includes('18'), sub1[0])
  check('progress uses first-open total (2 / 20 = 10%)', pct1 === 10, `(${pct1}%)`)
  check('continue count reads 2 / 20', count1.includes('2 / 20'), count1)
  check('reviews.json keeps initialTotal 20', (await savedReviewTotals()).includes(20), JSON.stringify(await savedReviewTotals()))
  await shot('p1-progress-after-keep')

  /* ---- 2. Oturumu yeniden aç: başlangıç sayısı korunur ---- */
  await click('.saved-session-card')
  check('session resumed', await waitReview())
  check('resume starts at 1 / 18', (await counterText()).includes('1 / 18'), await counterText())
  await reviewCount(3)
  check('counter at 4 / 18', (await counterText()).includes('4 / 18'), await counterText())
  await click('.pause-btn')
  check('paused again', await waitFor(() => exists('.continue-card'), 10000))
  await sleep(900)

  const sub2 = await texts('.saved-session-sub')
  const count2 = await text('.continue-count')
  const pct2 = await meterWidth()
  check('remaining count is 15', sub2[0]?.includes('15'), sub2[0])
  check('progress still based on 20 (5 / 20 = 25%)', pct2 === 25, `(${pct2}%)`)
  check('continue count reads 5 / 20', count2.includes('5 / 20'), count2)
  check('initialTotal survived resume (20)', (await savedReviewTotals()).includes(20), JSON.stringify(await savedReviewTotals()))
  await shot('p2-progress-after-resume')

  const passed = results.filter((entry) => entry.ok).length
  console.log(`[progress] ${passed}/${results.length} passed`)
  if (passed !== results.length) {
    console.log('[progress] FAILED:', results.filter((entry) => !entry.ok).map((entry) => entry.name).join(' | '))
    process.exitCode = 1
  }
  await sleep(300)
  win.close()
}
