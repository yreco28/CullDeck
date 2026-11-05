'use strict'

const path = require('node:path')
const fsp = require('node:fs/promises')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Gerçek kullanıcı verisinin kopyasını açar ve eski kök bazlı oturumun
 * klasör (scope) bazlı oturuma taşındığını doğrular.
 */
module.exports = async function runTest(win, dir) {
  const { app } = require('electron')
  await fsp.mkdir(dir, { recursive: true })
  const userData = app.getPath('userData')
  console.log('[migrate] userData =', userData)

  const raw = await fsp.readFile(path.join(userData, 'reviews.json'), 'utf8').catch(() => '(yok)')
  console.log('[migrate] reviews.json =', raw)

  const sessions = await win.webContents.executeJavaScript('window.api.reviewSessions()')
  console.log('[migrate] sessions =', JSON.stringify(sessions, null, 2))

  const parsed = JSON.parse(raw)
  const entries = Object.values(parsed)
  console.log('[migrate] entry count =', entries.length)
  for (const entry of entries) {
    console.log(
      '[migrate] entry',
      JSON.stringify({ roots: entry.roots, scope: entry.scope, mode: entry.review?.mode, items: entry.review?.items?.length, i: entry.review?.i })
    )
  }

  await sleep(400)
  win.close()
}
