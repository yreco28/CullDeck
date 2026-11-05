'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Her klasör/alt klasörün kendi oturumu:
 * A klasöründe işaretle -> B klasörüne geç -> A oturumu ve işaretleri korunmalı.
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
  const waitHome = () => waitFor(() => exists('.home-ready'), 40000)
  const waitReview = () => waitFor(() => exists('.strip-thumb'), 15000)
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
    // Çoklu oturum özelliği: A oturumu korunarak B yeni oturum olarak başlatılır.
    if (await exists('.session-choice-actions')) {
      console.log('[test] conflict modal -> start as new session')
      await clickText('Yeni bir oturum', '.session-choice-actions .btn')
      await sleep(400)
    }
    return waitReview()
  }
  const resumeCard = (label) =>
    js(
      `(() => { const card = [...document.querySelectorAll('.saved-session-card')].find(c => ((c.querySelector('.saved-session-name')?.textContent) || '').includes(${JSON.stringify(label)})); if (!card) return 'MISS'; card.click(); return 'OK' })()`
    )
  const goHome = async () => {
    await clickText('Temizle', '.nav-item')
    await sleep(600)
  }
  const pause = async () => {
    await click('.pause-btn')
    await sleep(900)
  }

  const photos = path.join(dir, '..', 'photos')
  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  /* ---- home: fotoğraf klasörleri bölümü yok ---- */
  check('home ready', await waitHome())
  check('folder card removed', !(await exists('.folder-card')))
  check(
    'photo folders section removed',
    await js(`![...document.querySelectorAll('.section-title')].some(e => (e.textContent||'').includes('Fotoğraf klasörleri'))`)
  )
  await shot('f01-home')

  /* ---- A klasöründe işaretle ---- */
  check('A review opened', await startReviewGroup('A'))
  await click('.round-btn.small', 1)
  await sleep(550)
  await click('.round-btn.small', 1)
  await sleep(550)
  check('A counter 3 / 20', (await text('.review-counter')).includes('3 / 20'), await text('.review-counter'))
  await pause()
  check('A paused to home', await exists('.continue-card'))
  check('one session after A', (await count('.saved-session-card')) === 1, `(${await count('.saved-session-card')})`)
  check('A session label', (await text('.saved-session-name')).includes('photos / A'), await text('.saved-session-name'))
  await shot('f02-home-A')

  /* ---- B klasörüne geç: A oturumu silinmemeli ---- */
  check('B review opened', await startReviewGroup('B'))
  await click('.round-btn.small', 1)
  await sleep(550)
  await pause()
  check('B paused to home', await exists('.continue-card'))
  check('two sessions after B', (await count('.saved-session-card')) === 2, `(${await count('.saved-session-card')})`)
  const labels = await js(`[...document.querySelectorAll('.saved-session-name')].map(e => e.textContent.trim())`)
  check('A and B sessions listed', labels.includes('photos / A') && labels.includes('photos / B'), JSON.stringify(labels))

  const list = await js('window.api.reviewSessions()')
  const aEntry = list.find((entry) => (entry.scope || []).some((p) => p.toLowerCase().endsWith('\\a')))
  const bEntry = list.find((entry) => (entry.scope || []).some((p) => p.toLowerCase().endsWith('\\b')))
  check('A session kept 18 remaining', Boolean(aEntry) && aEntry.remaining === 18, JSON.stringify(aEntry?.remaining))
  check('B session has 19 remaining', Boolean(bEntry) && bEntry.remaining === 19, JSON.stringify(bEntry?.remaining))
  check('sessions use different scopes', Boolean(aEntry && bEntry) && aEntry.scope[0] !== bEntry.scope[0])
  await shot('f03-home-AB')

  /* ---- A'ya dön: işaretler korunmalı ---- */
  check('resume A card', (await resumeCard('photos / A')) === 'OK')
  check('A review resumed', await waitReview())
  check('A counter still 3 / 20', (await text('.review-counter')).includes('3 / 20'), await text('.review-counter'))
  check('A skip marks preserved', (await count('.strip-thumb.skip')) === 2, `(${await count('.strip-thumb.skip')})`)
  await shot('f04-resumed-A')

  /* ---- B'ye geç, sonra tekrar A: hâlâ korunmalı ---- */
  await goHome()
  check('resume B card', (await resumeCard('photos / B')) === 'OK')
  check('B review resumed', await waitReview())
  check('B counter 2 / 20', (await text('.review-counter')).includes('2 / 20'), await text('.review-counter'))
  check('B skip mark preserved', (await count('.strip-thumb.skip')) === 1, `(${await count('.strip-thumb.skip')})`)
  await goHome()
  check('resume A card again', (await resumeCard('photos / A')) === 'OK')
  check('A review resumed again', await waitReview())
  check('A counter still 3 / 20 after B', (await text('.review-counter')).includes('3 / 20'), await text('.review-counter'))

  const failed = results.filter((entry) => !entry.ok)
  console.log(`[test] ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) console.log('[test] FAILED:', failed.map((entry) => entry.name).join(' | '))
  await sleep(300)
  win.close()
}