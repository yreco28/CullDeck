/* Arayüz ses efektleri.
   Dosyalar public/sounds altından kopyalanır; göreli yol paketlenmiş
   uygulamada da (file://) çalışır. Video sesinden bağımsızdır ve
   kısık seviyede çalar. */

const SOURCES = {
  keep: './sounds/keep.wav',
  delete: './sounds/delete.wav',
  finish: './sounds/finish.wav'
}

const VOLUME = 0.45
const pools = new Map()
let primed = false
let enabled = true

/* Ayarlardan ses efektleri kapatıldığında playSound sessizce döner. */
export function setSoundEnabled(value) {
  enabled = value !== false
}

function createAudio(src) {
  const audio = new Audio(src)
  audio.preload = 'auto'
  audio.volume = VOLUME
  return audio
}

/* İlk kullanımdan önce dosyaları belleğe al; ilk sesin gecikmesini önler. */
export function preloadSounds() {
  if (primed || typeof Audio === 'undefined') return
  primed = true
  for (const [key, src] of Object.entries(SOURCES)) {
    pools.set(key, [createAudio(src)])
  }
}

/* Aynı ses üst üste tetiklenirse boş bir kopya kullanılır;
   böylece hızlı Tut/Sil kararlarında ses kesilmez. */
export function playSound(key) {
  if (!enabled) return
  const src = SOURCES[key]
  if (!src || typeof Audio === 'undefined') return
  let pool = pools.get(key)
  if (!pool) {
    pool = [createAudio(src)]
    pools.set(key, pool)
  }
  let audio = pool.find((entry) => entry.paused || entry.ended)
  if (!audio) {
    audio = createAudio(src)
    pool.push(audio)
  }
  try {
    audio.currentTime = 0
    const result = audio.play()
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {
    /* ses çalınamazsa sessizce geç */
  }
}
