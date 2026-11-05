const normalize = (value) => String(value || '').replace(/[\\/]+$/, '').toLowerCase()

/** A stable key for "the set of folders this review belongs to". */
export function sessionKey(roots) {
  const list = (Array.isArray(roots) ? roots : roots ? [roots] : []).filter(Boolean)
  return list.map(normalize).sort().join('\u0000')
}

export function safeFolderName(folder) {
  const clean = String(folder || '').replace(/[\\/]+$/, '')
  const parts = clean.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || clean
}

export function folderNames(roots) {
  const list = (Array.isArray(roots) ? roots : roots ? [roots] : []).filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return safeFolderName(list[0])
  return `${safeFolderName(list[0])} +${list.length - 1}`
}

/** Absolute folder of a file, without Node's path module (renderer side). */
export function folderOf(file) {
  const clean = String(file || '').replace(/[\\/]+$/, '')
  const index = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  return index > 0 ? clean.slice(0, index) : clean
}

/** Unique folder paths for a list of review items. */
export function folderScope(items, fallback) {
  const seen = new Set()
  const out = []
  for (const item of items || []) {
    const folder = folderOf(item?.path)
    if (!folder) continue
    const key = normalize(folder)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(folder)
  }
  return out.length ? out : (Array.isArray(fallback) ? fallback : fallback ? [fallback] : [])
}

function relativeToRoot(folder, root) {
  const clean = String(folder || '').replace(/[\\/]+$/, '')
  const base = String(root || '').replace(/[\\/]+$/, '')
  const target = normalize(clean)
  const prefix = normalize(base)
  if (!prefix) return null
  if (target === prefix) return ''
  if (target.startsWith(`${prefix}\\`) || target.startsWith(`${prefix}/`)) {
    return clean.slice(base.length).replace(/^[\\/]+/, '')
  }
  return null
}

/**
 * Human label for a saved session scope.
 * e.g. "Recoeskiler / Camera1", "ShareX", "Recoeskiler / Pictures1 / WhatsApp".
 */
export function scopeLabel(scope, roots, t) {
  const list = (Array.isArray(scope) ? scope : scope ? [scope] : []).filter(Boolean)
  const rootList = (Array.isArray(roots) ? roots : roots ? [roots] : []).filter(Boolean)
  if (!list.length) return folderNames(rootList)
  const pretty = list.map((folder) => {
    const raw = String(folder || '')
    if (raw.startsWith('type:')) {
      const keys = raw.slice(5).split('+').filter(Boolean)
      if (!keys.length) return raw
      return keys.map((key) => (t ? t(`media.${key}`) : key)).join(' + ')
    }
    for (const root of rootList) {
      const rel = relativeToRoot(folder, root)
      if (rel === null) continue
      const base = safeFolderName(root)
      return rel ? `${base} / ${rel.split(/[\\/]/).join(' / ')}` : base
    }
    return safeFolderName(folder)
  })
  const head = pretty[0]
  return pretty.length > 1 ? `${head} +${pretty.length - 1}` : head
}

/** Remaining (not yet reviewed) item count of a saved review. */
export function remainingCount(review) {
  if (!review?.items?.length) return 0
  return Math.max(0, review.items.length - (review.i || 0))
}