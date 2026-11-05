'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function runResume(win, dir) {
  await fsp.mkdir(dir, { recursive: true })
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    await sleep(400)
    const image = await win.capturePage()
    await fsp.writeFile(path.join(dir, `${name}.png`), image.toPNG())
    console.log('[shot]', name)
  }
  const clickText = (text, selector = 'button') =>
    js(
      `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => (b.textContent || '').includes(${JSON.stringify(text)})); if (!el) return 'MISS'; el.click(); return 'OK' })()`
    )
  const exists = (selector) => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const counter = () => js(`(document.querySelector('.review-counter')?.textContent || '').trim()`)

  await sleep(1200)
  for (let i = 0; i < 60; i += 1) {
    if (await exists('.folder-count')) break
    await sleep(400)
  }

  const hasContinue = await exists('.continue-card')
  const continueText = await js(`(document.querySelector('.continue-card')?.textContent || '').trim()`)
  await shot('05-home-resume')

  let resumeCounter = '—'
  if (hasContinue) {
    console.log('[step]', await js(`(() => { const el = document.querySelector('.continue-card'); if (!el) return 'MISS'; el.click(); return 'OK' })()`))
    for (let i = 0; i < 30; i += 1) {
      if (await exists('.stage-card')) break
      await sleep(200)
    }
    await sleep(700)
    resumeCounter = await counter()
    await shot('06-resumed-review')
  }

  console.log('[result]', JSON.stringify({ hasContinue, continueText, resumeCounter }))
  await sleep(300)
  win.close()
}
