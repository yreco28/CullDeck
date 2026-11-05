'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

module.exports = async function runDrag(win, dir) {
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

  await sleep(1500)
  for (let i = 0; i < 60; i += 1) {
    if (await exists('.folder-count')) break
    await sleep(400)
  }

  console.log('[step]', await clickText('Albüme göre', '.mode-card'))
  await sleep(800)
  console.log('[step]', await clickText('incele'))
  for (let i = 0; i < 30; i += 1) {
    if (await exists('.stage-card')) break
    await sleep(200)
  }
  await sleep(600)
  await shot('01-review-before')
  const before = await counter()

  const rect = await js(`(() => { const el = document.querySelector('.stage-card'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  console.log('[drag] rect', JSON.stringify(rect))

  if (rect) {
    const steps = 12
    win.webContents.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    await sleep(120)
    for (let i = 1; i <= steps; i += 1) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x - Math.round((180 / steps) * i), y: rect.y, button: 'left', buttons: 1 })
      await sleep(28)
    }
    await sleep(120)
    win.webContents.sendInputEvent({ type: 'mouseUp', x: rect.x - 180, y: rect.y, button: 'left', clickCount: 1 })
  }

  await sleep(1400)
  await shot('02-after-drag')
  const afterDrag = await counter()

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
  await sleep(1200)
  await shot('03-after-key')
  const afterKey = await counter()

  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Z', modifiers: ['control'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Z', modifiers: ['control'] })
  await sleep(900)
  await shot('04-after-undo')
  const afterUndo = await counter()

  const saved = await fsp.readFile(path.join(process.env.APPDATA, 'CullDeck', 'review.json'), 'utf8').catch(() => '')
  let savedIndex = null
  try {
    savedIndex = JSON.parse(saved).i
  } catch {
    savedIndex = 'PARSE-FAIL'
  }

  console.log('[result]', JSON.stringify({ before, afterDrag, afterKey, afterUndo, savedIndex }))
  await sleep(300)
  win.close()
}
