export function formatBytes(bytes, lang = 'tr') {
  if (!bytes || bytes < 1) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits).replace('.', lang === 'tr' ? ',' : '.')} ${units[unit]}`
}

export function monthKey(timestamp) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key, locale) {
  const [year, month] = key.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
  return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
}

export function shortDate(timestamp, locale) {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(timestamp))
}

export function timeOfDay(timestamp, locale) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

export function relativeTime(timestamp, locale) {
  const diff = timestamp - Date.now()
  const abs = Math.abs(diff)
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (abs < minute) return formatter.format(Math.round(diff / 1000), 'second')
  if (abs < hour) return formatter.format(Math.round(diff / minute), 'minute')
  if (abs < day) return formatter.format(Math.round(diff / hour), 'hour')
  if (abs < 30 * day) return formatter.format(Math.round(diff / day), 'day')
  if (abs < 365 * day) return formatter.format(Math.round(diff / (30 * day)), 'month')
  return formatter.format(Math.round(diff / (365 * day)), 'year')
}

export function formatDuration(ms, lang = 'tr') {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (lang === 'en') {
    if (minutes === 0) return `${seconds}s`
    return `${minutes}m ${seconds}s`
  }
  if (minutes === 0) return `${seconds} sn`
  return `${minutes} dk ${seconds} sn`
}

export function percent(part, whole) {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}
