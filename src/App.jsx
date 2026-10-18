import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import SpaceScene from './components/SpaceScene'
import Overlay from './components/Overlay'
import ZoneMusic from './components/ZoneMusic'
import { stationMark, DOLPHIN_STOP_Z } from './stations'
import { CAT_MODE_ENABLED } from './features'

// офис с кошкой грузится отдельным файлом и только когда в него заходят
const CatWalkthrough = lazy(() => import('./components/CatWalkthrough'))

// Копирайт в левом нижнем углу — во всех режимах
function Copyright({ warm }) {
  return (
    <div style={{
      position: 'fixed', left: 24, bottom: 14, zIndex: 60, pointerEvents: 'none',
      fontSize: 11, letterSpacing: 0.5, zoom: "var(--ui, 1)",
      color: warm ? 'rgba(90,70,45,0.75)' : 'rgba(255,255,255,0.35)',
    }}>
      © 2026 Maria Zenina. All rights reserved.
    </div>
  )
}

// Телефон: сайт задуман в альбомной ориентации. На Android по первому нажатию уходим во весь экран
// и закрепляем горизонтальную ориентацию (браузеры разрешают это только в полноэкранном режиме);
// где это недоступно (iPhone), остаётся экран «Поверните телефон» — см. RotateHint
const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
function lockLandscape() {
  if (!isTouch || document.fullscreenElement) return
  document.documentElement.requestFullscreen?.()
    ?.then(() => screen.orientation?.lock?.("landscape"))
    .catch(() => {})
}

// Относительный масштаб интерфейса поверх сцены: 1 на экране ~1280×800 и больше,
// меньше — пропорционально меньшей стороне (телефон в альбомной ориентации ≈ 0.5).
// Используется в CSS как zoom: var(--ui)
function useUiScale() {
  useEffect(() => {
    const update = () => {
      const k = Math.min(window.innerWidth / 1280, window.innerHeight / 800)
      document.documentElement.style.setProperty("--ui", String(Math.min(1, Math.max(0.5, k))))
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
}

function RotateHint() {
  return (
    <div className="rotateHint" role="alert">
      <div className="rotateHintIcon" aria-hidden="true">📱</div>
      <p>Rotate your phone to landscape</p>
      <small>Поверните телефон горизонтально</small>
    </div>
  )
}

function App() {
  useUiScale()
  const [entered, setEntered] = useState(false)
  const [catMode, setCatMode] = useState(false)
  const [cameraZ, setCameraZ] = useState(5)
  const [flyTarget, setFlyTarget] = useState(null)   // автополёт камеры (Contact now)
  const [dolphinHold, setDolphinHold] = useState(false) // камера стоит, дельфины прыгают
  const [dolphinDone, setDolphinDone] = useState(false) // прыжок закончился — можно открыть Designs
  const [messengerDone, setMessengerDone] = useState({}) // вестник растаял — открыть его карточку
  const handleMessengerDone = useCallback((id, done) => setMessengerDone((m) => ({ ...m, [id]: done })), [])
  const handleFreezeChange = useCallback((on) => {
    setDolphinHold(on)
    if (!on) setDolphinDone(true)
  }, [])

  const handleZChange = useCallback((z) => {
    setCameraZ(z)
    if (z > DOLPHIN_STOP_Z + 1) setDolphinDone(false)   // вернулись назад — прыжок покажем снова
  }, [])
  const handleFlyEnd  = useCallback(() => setFlyTarget(null), [])
  const contactNow = () => {
    lockLandscape()
    setEntered(true)
    setFlyTarget({ z: stationMark('contact').triggerZ })
  }

  // Cat mode — офис с кошкой на табуретке, космическая сцена при этом не рендерится
  if (CAT_MODE_ENABLED && catMode) {
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
        <Suspense fallback={null}>
          <CatWalkthrough />
        </Suspense>
        <button
          type="button"
          onClick={() => setCatMode(false)}
          style={{
            position: 'fixed', top: 14, left: 14, zIndex: 70,
            padding: '8px 16px', borderRadius: 999, border: 0, cursor: 'pointer',
            background: 'rgba(61,49,40,0.85)', color: '#f0e4c8',
            font: 'inherit', fontSize: 13, fontWeight: 600,
            boxShadow: '0 6px 20px rgba(60,40,15,0.2)',
          }}
        >
          ← В космос
        </button>
        <Copyright warm />
        <RotateHint />
      </div>
    )
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 75 }}
        gl={{ antialias: true, toneMapping: 3 /* ACESFilmic */ }}
      >
        <SpaceScene onZChange={handleZChange} flyTarget={flyTarget} onFlyEnd={handleFlyEnd}
          onFreezeChange={handleFreezeChange} onMessengerDone={handleMessengerDone} />

        <EffectComposer>
          <Bloom
            intensity={1.4}          /* яркость свечения */
            luminanceThreshold={0.2} /* только яркие пиксели светятся */
            luminanceSmoothing={0.6}
            mipmapBlur              /* мягкое размытие */
          />
        </EffectComposer>
      </Canvas>

      <Overlay
        entered={entered}
        onEnter={() => { lockLandscape(); setEntered(true) }}
        onEnterCat={() => { lockLandscape(); setFlyTarget(null); setCatMode(true) }}
        onContactNow={contactNow}
        cameraZ={cameraZ}
        dolphinHold={dolphinHold}
        dolphinDone={dolphinDone}
        messengerDone={messengerDone}
      />

      <ZoneMusic active={entered} cameraZ={cameraZ} />
      <Copyright />
      <RotateHint />
    </div>
  )
}

export default App
