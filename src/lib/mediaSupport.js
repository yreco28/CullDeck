// Chromium'un kendi çözemediği kaplar: oynatma/görüntüleme yerine
// harici uygulamaya yönlendirilir. Ağır bir dönüştürücü (ffmpeg) eklenmedi.
const EXTERNAL_VIDEO = new Set(['.avi', '.wmv', '.flv', '.mpg', '.mpeg'])
const SHELL_IMAGE = new Set(['.tif', '.tiff', '.heic', '.heif'])

function extOf(item) {
  if (!item) return ''
  if (item.ext) return String(item.ext).toLowerCase()
  const name = item.name || item.path || ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

/** Bu video kabı Chromium'da oynatılamıyor → harici oynatıcı gerekir. */
export function needsExternalPlayer(item) {
  return item?.kind === 'video' && EXTERNAL_VIDEO.has(extOf(item))
}

/** Bu görsel biçimi Chromium'da çözülemiyor → Windows önizlemesi kullanılır. */
export function needsShellPreview(item) {
  return item?.kind === 'image' && SHELL_IMAGE.has(extOf(item))
}
