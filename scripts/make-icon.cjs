'use strict'

/**
 * CullDeck ikon üretici.
 * Çalıştırma:  npx electron scripts/make-icon.cjs
 *
 * Kaynak:  assets/icon.svg        (1024x1024 master, yuvarlatılmış köşeler)
 *          assets/icon-small.svg  (16-32 px için sadeleştirilmiş varyant)
 * Çıktı:   assets/icon.png (256), assets/icon.ico (16-256), public/icon.png, public/icon.ico
 *
 * Not: pencere şeffaflığı yerine ikon tam kanamalı çizilir, yuvarlatılmış köşeler
 * piksel bazında alfa maskesiyle kesilir; böylece kenarlar yumuşak kalır.
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const SMALL_LIMIT = 32
const PNG_SIZE = 256
const CORNER_RADIUS = 220 / 1024 // kaynak SVG'deki rx oranı
const SS = 4 // köşe maskesi örnekleme

// --- PNG kodlayıcı ----------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePNG(rgba, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function encodeICO(entries) {
  // 256 px PNG olarak, daha küçükler BMP olarak gömülür (en geniş uyumluluk)
  const payload = entries.map((entry) => ({
    size: entry.size,
    data: entry.size >= 256 ? entry.png : encodeBMPEntry(entry.rgba, entry.size)
  }))

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(payload.length, 4)

  const dir = Buffer.alloc(16 * payload.length)
  let offset = 6 + dir.length
  payload.forEach((entry, i) => {
    const p = i * 16
    dir[p] = entry.size >= 256 ? 0 : entry.size
    dir[p + 1] = entry.size >= 256 ? 0 : entry.size
    dir.writeUInt16LE(1, p + 4)
    dir.writeUInt16LE(32, p + 6)
    dir.writeUInt32LE(entry.data.length, p + 8)
    dir.writeUInt32LE(offset, p + 12)
    offset += entry.data.length
  })

  return Buffer.concat([header, dir, ...payload.map((entry) => entry.data)])
}

/** RGBA (üstten alta) -> ICO içindeki DIB: BITMAPINFOHEADER + BGRA + AND maskesi */
function encodeBMPEntry(rgba, size) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(size * size * 4, 20)

  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    const dstRow = size - 1 - y
    for (let x = 0; x < size; x += 1) {
      const s = (y * size + x) * 4
      const d = (dstRow * size + x) * 4
      xor[d] = rgba[s + 2]
      xor[d + 1] = rgba[s + 1]
      xor[d + 2] = rgba[s]
      xor[d + 3] = rgba[s + 3]
    }
  }

  const maskRow = Math.ceil(size / 32) * 4
  const and = Buffer.alloc(maskRow * size)
  for (let y = 0; y < size; y += 1) {
    const srcRow = size - 1 - y
    for (let x = 0; x < size; x += 1) {
      if (rgba[(srcRow * size + x) * 4 + 3] < 128) and[y * maskRow + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }

  return Buffer.concat([header, xor, and])
}

// --- çizim ------------------------------------------------------------------
const CORNERS = '<rect width="1024" height="1024" rx="220" fill="url(#bg)"/>'
const FULL_BLEED = '<rect width="1024" height="1024" fill="url(#bg)"/>'

/** Aynı sayfada iki SVG olduğu için id çakışmalarını önler */
function uniquify(svg, suffix) {
  return svg.replace(/id="([^"]+)"/g, `id="$1${suffix}"`).replace(/url\(#([^)]+)\)/g, `url(#$1${suffix})`)
}

/** BGRA bitmap -> RGBA + yuvarlatılmış köşe alfası */
function roundCorners(bgra, size) {
  const rgba = Buffer.alloc(size * size * 4)
  const radius = CORNER_RADIUS * size

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      rgba[i] = bgra[i + 2]
      rgba[i + 1] = bgra[i + 1]
      rgba[i + 2] = bgra[i]

      let covered = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          const qx = Math.max(radius - Math.min(px, size - px), 0)
          const qy = Math.max(radius - Math.min(py, size - py), 0)
          if (Math.hypot(qx, qy) <= radius) covered += 1
        }
      }
      rgba[i + 3] = Math.round((covered / (SS * SS)) * 255)
    }
  }
  return rgba
}

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..')
  const source = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8').replace(CORNERS, FULL_BLEED)
  const smallSource = uniquify(
    fs.readFileSync(path.join(root, 'assets', 'icon-small.svg'), 'utf8').replace(CORNERS, FULL_BLEED),
    'S'
  )
  const tmpFile = path.join(app.getPath('temp'), 'culldeck-icon-preview.html')

  fs.writeFileSync(
    tmpFile,
    `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;overflow:hidden;background:#fff}
      svg{display:block}
      #small{display:none}
    </style></head><body>
      <div id="big">${source}</div>
      <div id="small">${smallSource}</div>
    </body></html>`
  )

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false }
  })
  await win.loadFile(tmpFile)
  await new Promise((resolve) => setTimeout(resolve, 300))

  const entries = []
  for (const size of ICO_SIZES) {
    const variant = size <= SMALL_LIMIT ? 'small' : 'big'
    await win.webContents.executeJavaScript(`(() => {
      const big = document.getElementById('big')
      const small = document.getElementById('small')
      big.style.display = '${variant === 'big' ? 'block' : 'none'}'
      small.style.display = '${variant === 'small' ? 'block' : 'none'}'
      const svg = document.getElementById('${variant}').querySelector('svg')
      svg.style.width = '${size}px'
      svg.style.height = '${size}px'
      return true
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 120))

    let image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    if (image.getSize().width !== size) image = image.resize({ width: size, height: size, quality: 'best' })

    const rgba = roundCorners(image.toBitmap(), size)
    const png = encodePNG(rgba, size, size)
    entries.push({ size, png, rgba })

    if (size === PNG_SIZE) {
      fs.mkdirSync(path.join(root, 'assets'), { recursive: true })
      fs.mkdirSync(path.join(root, 'public'), { recursive: true })
      fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png)
      fs.writeFileSync(path.join(root, 'public', 'icon.png'), png)
    }
  }

  const ico = encodeICO(entries)
  fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), ico)
  fs.writeFileSync(path.join(root, 'public', 'icon.ico'), ico)

  win.destroy()
  fs.rmSync(tmpFile, { force: true })

  console.log(`[icon] ico: ${ICO_SIZES.join(', ')} px — ${ico.length} bayt`)
  app.quit()
}).catch((error) => {
  console.error('[icon] hata:', error)
  app.exit(1)
})
