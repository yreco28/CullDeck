'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Tür (medya türü) oturumları:
 *  - eski sürümde kök klasör başına bölünmüş oturumlar tek oturumda birleşir,
 *  - oturum adı medya türüdür (Fotoğraf / Video / GIF),
 *  - yeni açılan tür oturumu tüm kök klasörleri tek oturumda toplar.
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
  const count = (selector) => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const texts = (selector) =>
    js(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => (el.textContent || '').trim())`)
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
  const counterText = () => js(`(document.querySelector('.review-counter') || {}).textContent || ''`)
  const clickGroup = (name) =>
    js(
      `(() => { const el = [...document.querySelectorAll('.group-row')].find(r => ((r.querySelector('.group-name')?.textContent) || '').trim() === ${JSON.stringify(name)}); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const clickMode = (text) =>
    js(
      `(() => { const el = [...document.querySelectorAll('.mode-card')].find(b => (b.textContent || '').includes(${JSON.stringify(text)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )

  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(ok ? '[test] PASS' : '[test] FAIL', name, extra)
  }

  check('home ready', await waitHome())

  /* ---- 1. Eski kök-başına tür oturumları tek oturumda birleşti ---- */
  check('merged type sessions into one row', await waitFor(async () => (await count('.saved-session-row')) === 1, 15000), `(${await count('.saved-session-row')})`)
  const names = await texts('.saved-session-name')
  check('session is named after the media type', names[0] === 'Fotoğraf', names.join(' | '))
  const subs = await texts('.saved-session-sub')
  check('session is marked as type and keeps merged progress', subs[0]?.includes('Tür') && subs[0]?.includes('25'), subs[0])
  await shot('t1-merged-type-session')

  /* ---- 2. Oturumu kapat: tek kayıt da silinsin ---- */
  await click('.saved-session-close')
  await sleep(500)
  check('close asks confirmation', await exists('.modal .btn-danger'))
  await click('.modal .btn-danger')
  check('type session removed', await waitFor(async () => (await count('.saved-session-row')) === 0, 8000), `(${await count('.saved-session-row')})`)

  /* ---- 3. Yeni tür oturumu: iki kök klasör tek oturum ---- */
  check('type mode card exists', (await clickMode('Medya türüne göre')) !== 'MISS')
  check('type selector opened', await waitFor(() => exists('.group-row'), 15000))
  const groupNames = await texts('.group-name')
  check('type groups are media types', groupNames.includes('Fotoğraf'), groupNames.join(' | '))
  check('photo group selected', (await clickGroup('Fotoğraf')) !== 'MISS')
  await sleep(400)
  await click('.select-bar .btn-primary')
  check('review opened', await waitReview())
  check('all roots in one session (50 items)', (await counterText()).includes('1 / 50'), await counterText())
  await shot('t2-type-review')

  await clickText('Temizle', '.nav-item')
  check('back home', await waitHome())
  check('one saved type session', await waitFor(async () => (await count('.saved-session-row')) === 1, 10000), `(${await count('.saved-session-row')})`)
  const newNames = await texts('.saved-session-name')
  const newSubs = await texts('.saved-session-sub')
  check('new session named Fotoğraf', newNames[0] === 'Fotoğraf', newNames.join(' | '))
  check('new session marked Tür, 50 remaining', newSubs[0]?.includes('Tür') && newSubs[0]?.includes('50'), newSubs[0])
  await shot('t3-type-session-home')

  /* ---- 4. Devam et ---- */
  await click('.saved-session-card')
  check('type session resumes', await waitReview())
  check('resume keeps all 50 items', (await counterText()).includes('1 / 50'), await counterText())

  // Oturumu uygulamadan kapat.
  await click('.review-top .btn-ghost.btn-icon', 0)
  await sleep(500)
  if (await exists('.modal .btn-danger')) {
    await click('.modal .btn-danger')
    await sleep(700)
  }

  const passed = results.filter((r) => r.ok).length
  console.log(`[type] ${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
  await sleep(300)
  win.close()
}
