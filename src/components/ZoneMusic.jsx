import { useEffect, useRef, useState } from 'react'

// файлы из public/ — от адреса сайта (на GitHub Pages он не корень домена, а /space-portfolio/)
const ASSET = import.meta.env.BASE_URL

// Границы зон — те же, что в SpaceScene (Z уменьшается при движении вперёд)
const FOREST_START = -200
const SEA_START    = -460
const FADE = 40          // ширина перехода между треками, в единицах Z
const MAX_VOLUME = 0.6

const TRACKS = [
  { key: 'space',  src: ASSET + 'audio/space.mp3'  },
  { key: 'forest', src: ASSET + 'audio/forest.mp3' },
  { key: 'sea',    src: ASSET + 'audio/sea.mp3'    },
]

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smooth = (t) => t * t * (3 - 2 * t)

// 0 → 1, когда камера проходит границу (с запасом FADE/2 в обе стороны)
const crossed = (z, border) => smooth(clamp((border + FADE / 2 - z) / FADE, 0, 1))

function zoneVolumes(z) {
  const toForest = crossed(z, FOREST_START)
  const toSea    = crossed(z, SEA_START)
  return {
    space:  1 - toForest,
    forest: toForest * (1 - toSea),
    sea:    toSea,
  }
}

// выбор «без звука» запоминается в этом браузере
const MUTE_KEY = 'portfolio-muted'
const readMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false } }

export default function ZoneMusic({ active, cameraZ }) {
  const audios = useRef({})
  const [muted, setMuted] = useState(readMuted)
  useEffect(() => {
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* хранилище недоступно — не страшно */ }
  }, [muted])

  // создаём плееры один раз
  useEffect(() => {
    const map = {}
    for (const t of TRACKS) {
      const a = new Audio(t.src)
      a.loop = true
      a.volume = 0
      a.preload = 'auto'
      map[t.key] = a
    }
    audios.current = map
    return () => { for (const a of Object.values(map)) { a.pause(); a.src = '' } }
  }, [])

  // громкость по положению камеры; трек с нулевой громкостью ставим на паузу
  useEffect(() => {
    if (!active) return
    const vols = zoneVolumes(cameraZ)
    for (const [key, a] of Object.entries(audios.current)) {
      const v = muted ? 0 : vols[key] * MAX_VOLUME
      a.volume = clamp(v, 0, 1)
      if (v > 0.001 && a.paused) a.play().catch(() => {})
      else if (v <= 0.001 && !a.paused) a.pause()
    }
  }, [active, cameraZ, muted])

  if (!active) return null

  return (
    <button
      type="button"
      onClick={() => setMuted(m => !m)}
      aria-label={muted ? 'Включить музыку' : 'Выключить музыку'}
      title={muted ? 'Включить музыку' : 'Выключить музыку'}
      style={{
        position: 'fixed', left: 24, bottom: 40, zIndex: 20, zoom: 'var(--ui, 1)',   // над строкой копирайта
        width: 44, height: 44, borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.25)',
        background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(6px)',
        color: 'rgba(255,255,255,0.8)', fontSize: 18, cursor: 'pointer',
      }}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  )
}
