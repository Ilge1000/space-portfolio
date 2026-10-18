import { useRef, useMemo, useEffect, Suspense } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js'
import * as THREE from 'three'
import { STATION_MARKS, STATION_RANGE, DOLPHIN_STOP_Z, CAMERA_END_Z, messengerTriggerZ } from '../stations'
import { getPath, samplePath, WATER_MODELS, routeStart, routeHold, SEA_CHAIN, seaChain, resetSeaChain } from '../trajectories'

// файлы из public/ — от адреса сайта (на GitHub Pages он не корень домена, а /space-portfolio/)
const ASSET = import.meta.env.BASE_URL

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function makeCircleTex(color) {
  const s = 64
  const canvas = document.createElement('canvas')
  canvas.width = s; canvas.height = s
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2)
  g.addColorStop(0, color); g.addColorStop(0.5, color); g.addColorStop(1, 'transparent')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(s/2, s/2, s/2, 0, Math.PI * 2); ctx.fill()
  return new THREE.CanvasTexture(canvas)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// камеру только что перенесли (навигация по разделам, редактор, «Experience again»): вестники не
// должны принять перенос за пролёт мимо них. Флаг живёт до следующего кадра FlightControls, так
// что его видят все useFrame — и до, и после FlightControls
const camTeleport = { pending: false }

// Полёт по траектории, нарисованной в редакторе (trajectories.js): на экране вестник повторяет
// линию, а по глубине приближается от стартовой точки к endDepth перед камерой. Первую четверть
// пути он плавно переходит с места, где реально сидел, на нарисованную линию.
const _pp = { x: 0, y: 0 }
function pathFlightPos(fl, e, d, camera, out) {
  samplePath(fl.path, e, _pp)
  const b = fl.startNdc ? 1 - THREE.MathUtils.smoothstep(e, 0, 0.25) : 0
  const x = _pp.x + (b && (fl.startNdc.x - fl.path[0][0]) * b)
  const y = _pp.y + (b && (fl.startNdc.y - fl.path[0][1]) * b)
  const h = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d
  return out.set(camera.position.x + x * h * camera.aspect, camera.position.y + y * h, camera.position.z - d)
}
// в момент срыва: берём путь и запоминаем, где вестник на экране и как далеко
function startPathFlight(id, startPos, camera) {
  const path = getPath(id)
  if (!path || path.length < 2) return null
  const ndc = startPos.clone().project(camera)
  return { path, startNdc: { x: ndc.x, y: ndc.y }, startDepth: Math.max(camera.position.z - startPos.z, 1) }
}

const randZ = (start, end) => start - Math.random() * Math.abs(end - start) // start и end отрицательные, end < start

// Зоны (Z уменьшается при движении вперёд):
// Космос:   Z  0   →  -200
// Лес:      Z -200 →  -460
// Море:     Z -460 →  -650
// Пляж:     Z -650 →  -672 (камера стоит у берега; узкая полоска песка — SHORE_Z…SAND_END_Z)

const FOREST_START = -200
const FOREST_END   = -460
const SEA_START    = -460
const BEACH_START  = -650
const SHORE_Z      = -690   // линия прибоя: тут кончается море и начинается песок
const SAND_END_Z   = -706   // дальний край полоски пляжа
// кромка воды слегка волнистая
const shoreEdgeZ = (x) => SHORE_Z + Math.sin(x * 0.18) * 1.1 + Math.sin(x * 0.07 + 1) * 0.8

const forestProgress = (z) => clamp((z - FOREST_START) / (FOREST_END   - FOREST_START), 0, 1)  // лес 0→1
const seaProgress    = (z) => clamp((z - SEA_START)    / (BEACH_START  - SEA_START),    0, 1)  // море 0→1
const beachProgress  = (z) => clamp((z - BEACH_START)  / (CAMERA_END_Z - BEACH_START),   0, 1)
// видимость воды: проявляется, когда до моря 140 → 40 единиц, — так же заранее, как морские объекты
const seaApproach    = (z) => clamp((SEA_START + 140 - z) / 100, 0, 1)
// смена «космос → лес»: лес проявляется на подлёте (до границы 90 → 10 единиц),
// а космические звёзды гаснут в коротком окне вокруг границы (за 30 до неё → 30 после)
const forestApproach = (z) => clamp((FOREST_START + 90 - z) / 80, 0, 1)
const spaceFade      = (z) => 1 - clamp((FOREST_START + 30 - z) / 60, 0, 1)

// точка, равномерно заполняющая поле зрения на глубине depth — без видимой «коробки» по краям
// (поле зрения 75°, экран шире, чем выше: по горизонтали берём с запасом)
function frustumXY(depth) {
  return [(Math.random() - 0.5) * 3.0 * depth, (Math.random() - 0.5) * 1.8 * depth]
}

// ─── Кривая пути ─────────────────────────────────────────────────────────────

function buildPathCurve() {
  const controls = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const z = -10 - t * 800
    const x = Math.sin(t * Math.PI * 3.5) * 5 + Math.sin(t * Math.PI * 7) * 2
    const y = -3.7 + Math.sin(t * Math.PI * 5) * 0.3 + (t > 0.85 ? (t - 0.85) / 0.15 * 10 : 0)
    controls.push(new THREE.Vector3(x, y, z))
  }
  return new THREE.CatmullRomCurve3(controls)
}
const PATH_CURVE = buildPathCurve()

// ─── Космические звёзды ───────────────────────────────────────────────────────

function WarpStars({ count = 3000 }) {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#ddeeff'), [])

  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const speeds    = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const depth = 15 + Math.random() * 585
      const [x, y] = frustumXY(depth)
      positions[i*3]   = x
      positions[i*3+1] = y
      positions[i*3+2] = 5 - depth            // 5 — стартовая позиция камеры
      speeds[i] = 0.4 + Math.random() * 0.9
    }
    return { positions, speeds }
  }, [count])

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
    return g
  }, [positions])

  useFrame((state, delta) => {
    if (!ref.current) return
    const camZ = state.camera.position.z
    // гаснут у самой границы леса — коротко, без долгого наложения на деревья
    const fade = spaceFade(camZ)
    ref.current.material.opacity = fade
    ref.current.visible = fade > 0.01
    if (!ref.current.visible) return
    const pos = ref.current.geometry.attributes.position
    for (let i = 0; i < count; i++) {
      pos.array[i*3+2] += speeds[i] * delta * 9
      if (pos.array[i*3+2] > camZ + 15) {
        const [x, y] = frustumXY(600)
        pos.array[i*3]   = x
        pos.array[i*3+1] = y
        pos.array[i*3+2] = camZ - 600
      }
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} size={0.45} sizeAttenuation alphaTest={0.05} transparent depthWrite={false} color="#ddeeff" />
    </points>
  )
}

// ─── Мерцающие блёстки ────────────────────────────────────────────────────────

function TwinklePoints({ count, colorSpace, colorForest, speed, phase }) {
  const ref     = useRef()
  const matRef  = useRef()
  const texSpace = useMemo(() => makeCircleTex(colorSpace), [colorSpace])
  const colorObj = useMemo(() => new THREE.Color(colorSpace), [colorSpace])

  const geo = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const depth = 30 + Math.random() * 370
      const [x, y] = frustumXY(depth)
      arr[i*3]   = x
      arr[i*3+1] = y
      arr[i*3+2] = -depth
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [count])

  useFrame(({ clock, camera }) => {
    if (!ref.current || !matRef.current) return
    const t  = clock.getElapsedTime() + phase
    // в лесу звёзды становятся зелёными светлячками — в том же окне у границы, где гаснут космические
    const toForest = (1 - spaceFade(camera.position.z)) * (1 - seaProgress(camera.position.z))
    matRef.current.opacity = (0.25 + 0.55 * Math.abs(Math.sin(t * speed))) * (1 - 0.4 * toForest)
    colorObj.set(colorSpace)
      .lerp(new THREE.Color(colorForest), toForest)
    matRef.current.color = colorObj
    ref.current.position.z = camera.position.z
  })

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial ref={matRef} map={texSpace} size={0.8} sizeAttenuation alphaTest={0.05} transparent opacity={0.5} depthWrite={false} color={colorSpace} />
    </points>
  )
}

// ─── Линия пути (идёт через все зоны до конца) ───────────────────────────────

function PathLine() {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#ffffff'), [])

  const geo = useMemo(() => {
    const pts = PATH_CURVE.getPoints(2000)
    const arr = []
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (p.z < SHORE_Z + 2) break                 // путь кончается у кромки воды
      const copies = i % 3 === 0 ? 3 : 2
      for (let c = 0; c < copies; c++) {
        arr.push(
          p.x + (Math.random() - 0.5) * 0.25,
          p.y + (Math.random() - 0.5) * 0.08,
          p.z + (Math.random() - 0.5) * 0.15
        )
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3))
    return g
  }, [])

  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    ref.current.material.opacity = 0.55 + 0.2 * Math.sin(t * 2.1)
  })

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} size={0.15} sizeAttenuation alphaTest={0.05}
        transparent opacity={0} depthWrite={false} color="#ffffff" />
    </points>
  )
}

// ─── Лес: земля и трава из частиц ────────────────────────────────────────────
// Деревья, облака и птичка — low-poly модели, см. FOREST_OBJECTS.
// Все элементы существуют только до Z = FOREST_END

function ParticleGround() {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#2d6e3e'), [])
  const geo = useMemo(() => {
    const arr = new Float32Array(10000 * 3)
    for (let i = 0; i < 10000; i++) {
      arr[i*3]   = (Math.random() - 0.5) * 140
      arr[i*3+1] = -4 + (Math.random() - 0.5) * 0.3
      arr[i*3+2] = randZ(FOREST_START, FOREST_END)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  useFrame(({ camera }) => {
    if (!ref.current) return
    const fa = forestApproach(camera.position.z)
    ref.current.material.opacity = fa * 0.7
    ref.current.visible = fa > 0.01
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} size={0.18} sizeAttenuation alphaTest={0.05}
        transparent opacity={0} depthWrite={false} color="#2d6e3e" />
    </points>
  )
}

function ParticleGrass() {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#55cc66'), [])
  const geo = useMemo(() => {
    const rng = (lo, hi) => lo + Math.random() * (hi - lo)
    const pts = []
    for (let b = 0; b < 1000; b++) {
      const bx = (Math.random() - 0.5) * 120
      const bz = randZ(FOREST_START, FOREST_END)
      const blades = Math.floor(rng(3, 7))
      for (let j = 0; j < blades; j++) {
        const ox = (Math.random() - 0.5) * 0.5; const h = rng(0.3, 1.1)
        for (let s = 0; s <= 4; s++) pts.push(bx + ox, -4 + s/4 * h, bz + (Math.random()-0.5)*0.3)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    return g
  }, [])
  useFrame(({ clock, camera }) => {
    if (!ref.current) return
    const fa = forestApproach(camera.position.z)
    const t = clock.getElapsedTime()
    ref.current.material.opacity = fa * 0.9
    ref.current.material.size = 0.12 + 0.04 * Math.sin(t * 1.5)
    ref.current.visible = fa > 0.01
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} size={0.12} sizeAttenuation alphaTest={0.05}
        transparent opacity={0} depthWrite={false} color="#55cc66" />
    </points>
  )
}

// ─── Море — сплошное поле синих частиц ───────────────────────────────────────

function SeaParticles() {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#1a7acc'), [])

  const { geo, origY } = useMemo(() => {
    const count = 16000
    const arr   = new Float32Array(count * 3)
    const origY = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 160
      const y = -4 + (Math.random() - 0.5) * 0.4
      const z = randZ(SEA_START, SHORE_Z)
      arr[i*3]   = x; arr[i*3+1] = y; arr[i*3+2] = z
      origY[i] = y
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return { geo: g, origY }
  }, [])

  useFrame(({ clock, camera }) => {
    if (!ref.current) return
    // вода проявляется заранее, на подлёте, — вместе с морскими объектами
    const sa = seaApproach(camera.position.z)
    ref.current.material.opacity = sa * 0.82
    ref.current.visible = sa > 0.01

    const pos = ref.current.geometry.attributes.position
    const t   = clock.getElapsedTime()
    for (let i = 0; i < 16000; i++) {
      const x = pos.array[i*3]; const z = pos.array[i*3+2]
      pos.array[i*3+1] = origY[i] + Math.sin(x * 0.3 + t * 1.2) * 0.22
                                   + Math.sin(z * 0.15 + t * 0.8) * 0.18
    }
    pos.needsUpdate = true
  })

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} size={0.2} sizeAttenuation alphaTest={0.05}
        transparent opacity={0} depthWrite={false} color="#1a7acc" />
    </points>
  )
}

function SeaGlints() {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#88ddff'), [])
  const geo = useMemo(() => {
    const count = 1000; const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i*3]   = (Math.random()-0.5)*140; arr[i*3+1] = -3.6 + Math.random()*0.4
      arr[i*3+2] = randZ(SEA_START, SHORE_Z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  useFrame(({ clock, camera }) => {
    if (!ref.current) return
    const sa = seaApproach(camera.position.z); const t = clock.getElapsedTime()
    ref.current.material.opacity = sa * 0.9 * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.8)))
    ref.current.material.size    = 0.3 + 0.2 * Math.abs(Math.sin(t * 1.9))
    ref.current.visible = sa > 0.01
  })
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} size={0.3} sizeAttenuation alphaTest={0.05}
        transparent opacity={0} depthWrite={false} color="#88ddff" />
    </points>
  )
}

// ─── Морские объекты из частиц (модели из Blender, public/models/*.glb) ──────
// Каждая модель — меш с цветами вершин; точки берутся с её поверхности.
// При приближении камеры частицы слетаются из облака в фигуру.

const SEA_OBJECTS = [
  { url: ASSET + 'models/sailboat.glb',   pos: WATER_MODELS.sailboat.pos, pathId: 'sailboat', rot: [0,  0.45, 0], scale: 2.2, count: 4500, anim: 'bob'   },
  // два парусника поменьше сопровождают первый: идут за ним по тому же пути лесенкой
  // (follow: gap — отставание по пути, side — сдвиг вбок в сторону ОТ камеры, в единицах сцены),
  // поэтому в кадре всегда дальше и мельче главного; без нарисованного пути — стоят позади
  { url: ASSET + 'models/sailboat.glb',   pos: [-15.5, -3.75, -511], pathId: 'sailboat', follow: { gap: 5,  side: 3 }, rot: [0, 0.45, 0], scale: 1.6, count: 3200, anim: 'bob' },
  { url: ASSET + 'models/sailboat.glb',   pos: [-18,   -3.75, -517], pathId: 'sailboat', follow: { gap: 10, side: 6 }, rot: [0, 0.45, 0], scale: 1.3, count: 2600, anim: 'bob' },
  // три дельфина по очереди перепрыгивают линию пути (x считается от пути, pos[0] не используется)
  // в одном месте, по одной дуге друг за другом; камера замирает перед ними на DOLPHIN_STOP_Z (уже над водой)
  { url: ASSET + 'models/dolphin.glb',    pos: [  0, -4.6,  -488],   rot: [0, 0, 0],   scale: 2.4, count: 3000, anim: 'leap', leapDelay: 0 },
  { url: ASSET + 'models/dolphin.glb',    pos: [  0, -4.6,  -488.6], rot: [0, 0, 0],   scale: 2.2, count: 3000, anim: 'leap', leapDelay: 1 },
  { url: ASSET + 'models/dolphin.glb',    pos: [  0, -4.6,  -487.4], rot: [0, 0, 0],   scale: 2.0, count: 3000, anim: 'leap', leapDelay: 2 },
  { url: ASSET + 'models/turtle.glb',     pos: WATER_MODELS.turtle.pos, pathId: 'turtle', rot: [0,  0.9,  0], scale: 2.0, count: 3500, anim: 'swim'  },
  // стайка: впереди три большие черепахи в ряд (первая — по нарисованному пути, две по бокам),
  // за ними две маленькие (follow — как у парусников: gap — отставание по пути, side — сдвиг вбок,
  // > 0 — от камеры, < 0 — к камере); без нарисованного пути — плавают рядом
  { url: ASSET + 'models/turtle.glb',     pos: [-12,  -3.6, -552],  pathId: 'turtle', follow: { gap: 1.5, side:  5.5 }, rot: [0, 0.9, 0], scale: 2.0, count: 3500, anim: 'swim' },
  { url: ASSET + 'models/turtle.glb',     pos: [ 0,   -3.6, -548],  pathId: 'turtle', follow: { gap: 1.5, side: -5.5 }, rot: [0, 0.9, 0], scale: 2.0, count: 3500, anim: 'swim' },
  { url: ASSET + 'models/turtle.glb',     pos: [-8.5, -3.6, -559],  pathId: 'turtle', follow: { gap: 9,   side:  2.6 }, rot: [0, 0.9, 0], scale: 1.1, count: 1800, anim: 'swim' },
  { url: ASSET + 'models/turtle.glb',     pos: [-3.5, -3.6, -558],  pathId: 'turtle', follow: { gap: 9,   side: -2.6 }, rot: [0, 0.9, 0], scale: 1.1, count: 1800, anim: 'swim' },
  { url: ASSET + 'models/ship.glb',       pos: WATER_MODELS.ship.pos, pathId: 'ship', rot: [0, -1.0,  0], scale: 2.6, count: 6500, anim: 'bob'   },
  { url: ASSET + 'models/lighthouse.glb', pos: [-17, -5.2,  -615], rot: [0,  0.6,  0], scale: 2.6, count: 6000, anim: 'beam'  },
  { url: ASSET + 'models/starfish.glb',   pos: [  5, -3.75, -640], rot: [0.5, 0,   0], scale: 1.6, count: 2500, anim: 'spin'  },
]

// Пляж (зона Contact): модели из beach_models.blend, стоят на песке (y = -4)
// всё стоит на узкой полоске песка (SHORE_Z…SAND_END_Z) перед остановившейся камерой;
// почтовый ящик — в центре, из него вылетает письмо (раздел Contact)
const BEACH_OBJECTS = [
  { url: ASSET + 'models/beach_palm.glb',       pos: [-27, -4, -695], rot: [0,  0.4, 0], scale: 1.6, count: 5000, anim: 'sway' },
  { url: ASSET + 'models/beach_palm.glb',       pos: [-19, -4, -702], rot: [0,  1.9, 0], scale: 1.4, count: 4500, anim: 'sway' },
  { url: ASSET + 'models/beach_palm.glb',       pos: [-11, -4, -704], rot: [0, -0.8, 0], scale: 1.2, count: 4000, anim: 'sway' },
  { url: ASSET + 'models/beach_palm.glb',       pos: [ 13, -4, -704], rot: [0,  2.6, 0], scale: 1.3, count: 4000, anim: 'sway' },
  { url: ASSET + 'models/beach_palm.glb',       pos: [ 21, -4, -699], rot: [0, -2.2, 0], scale: 1.5, count: 4500, anim: 'sway' },
  { url: ASSET + 'models/beach_palm.glb',       pos: [ 30, -4, -694], rot: [0,  0.9, 0], scale: 1.7, count: 5000, anim: 'sway' },
  { url: ASSET + 'models/beach_umbrella.glb',   pos: [  8, -4, -696], rot: [0, -0.6, 0], scale: 1.3, count: 3000 },
  { url: ASSET + 'models/beach_castle.glb',     pos: [ -7, -4, -697], rot: [0,  0.5, 0], scale: 1.0, count: 3500 },
  { url: ASSET + 'models/beach_surfboard.glb',  pos: [ 15, -4, -697], rot: [0,  0.3, 0], scale: 1.1, count: 1800 },
  { url: ASSET + 'models/beach_mailbox.glb',    pos: [  1, -4, -695], rot: [0,  0.3, 0], scale: 1.6, count: 2200 },
]

// Лес (low-poly модели из forest_models.blend): деревья по обе стороны тропы, облака над ними,
// птичка на пеньке у тропы. Раскладка псевдослучайная, но одинаковая при каждой загрузке.
// count — число частиц для дерева «среднего» размера; маленьким даём меньше, большим больше
const TREE_KINDS = [
  { url: ASSET + 'models/forest_oak.glb',      count: 3000 },
  { url: ASSET + 'models/forest_birch.glb',    count: 2200 },
  { url: ASSET + 'models/forest_fir.glb',      count: 2600 },
  { url: ASSET + 'models/forest_fir_slim.glb', count: 2200 },
  { url: ASSET + 'models/forest_poplar.glb',   count: 1800 },
]

// ряды деревьев: ближний — плотный, у тропы; дальний — реже и вглубь, с меньшим числом частиц
const TREE_ROWS = [
  { step: 7,  near: 8,  far: 24, detail: 1.0 },
  { step: 9,  near: 26, far: 60, detail: 0.55 },
]

function buildForestLayout() {
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  const pathX = (z) => PATH_CURVE.getPoint(clamp((-10 - z) / 800, 0, 1)).x
  const list = []
  // деревья в два ряда по обе стороны тропы; размеры от деревца (~1.2) до великана (~4),
  // большинство средние; у каждого свои пропорции — выше и стройнее или ниже и шире
  for (const row of TREE_ROWS) {
    for (let z = FOREST_START - 4; z > FOREST_END + 6; z -= row.step) {
      for (const side of [-1, 1]) {
        const kind = TREE_KINDS[Math.floor(rnd() * TREE_KINDS.length)]
        const zz = z + (rnd() - 0.5) * row.step * 0.8
        const size = 1.2 + Math.pow(rnd(), 1.6) * 2.8
        const tall = 0.75 + rnd() * 0.6          // вытянутость по высоте
        const wide = 0.8 + rnd() * 0.4           // ширина кроны
        list.push({ url: kind.url,
          count: Math.round(kind.count * row.detail * clamp(size / 2.6, 0.5, 1.3)),
          pos: [pathX(zz) + side * (row.near + rnd() * (row.far - row.near)), -4, zz],
          rot: [0, rnd() * Math.PI * 2, 0],
          scale: [size * wide, size * tall, size * wide] })
      }
    }
  }
  // кленовые саженцы — мелкие акценты между деревьями (не вплотную к тропе: вблизи камеры
  // их частицы разрастаются на пол-экрана)
  for (let i = 0; i < 8; i++) {
    const zz = FOREST_START - 15 - rnd() * (FOREST_START - FOREST_END - 30)
    list.push({ url: ASSET + 'models/forest_maple.glb', count: 800,
      pos: [pathX(zz) + (rnd() < 0.5 ? -1 : 1) * (9 + rnd() * 6), -4, zz],
      rot: [0, rnd() * Math.PI * 2, 0], scale: 1.6 + rnd() * 0.6 })
  }
  // облака над лесом
  for (let i = 0; i < 9; i++) {
    const zz = FOREST_START - 20 - i * 28 - rnd() * 10
    list.push({ url: rnd() < 0.5 ? ASSET + 'models/forest_cloud_a.glb' : ASSET + 'models/forest_cloud_b.glb', count: 1500,
      pos: [(rnd() - 0.5) * 70, 11 + rnd() * 8, zz], rot: [0, (rnd() - 0.5) * 0.6, 0],
      scale: 2.5 + rnd() * 1.8, anim: 'drift' })
  }
  // дерево, на котором сидит птица-вестник (см. BirdMessenger); без поворота и растяжения,
  // чтобы точно знать, где макушка кроны
  list.push({ url: ASSET + 'models/forest_oak.glb', count: 3500, pos: PERCH_TREE.pos, rot: [0, 0, 0], scale: PERCH_TREE.scale })
  // дерево, с которого срывается листок-вестник (см. LeafMessenger)
  list.push({ url: ASSET + 'models/forest_oak.glb', count: 3500, pos: LEAF_TREE.pos, rot: [0, 0, 0], scale: LEAF_TREE.scale })
  return list
}

// листок-вестник раздела Education. Когда камера доходит до точки срыва (LEAF_TRIGGER_Z),
// листок висит на 14 единиц впереди — примерно в середине левой части кадра; дуб ставим так,
// чтобы листок оказался на правом краю его кроны
const LEAF_STATION   = STATION_MARKS.find((s) => s.messenger === 'leaf')
const LEAF_TRIGGER_Z = LEAF_STATION ? messengerTriggerZ(LEAF_STATION) : -240
const LEAF_DEPTH     = 18
// левее центра и чуть выше середины кадра — чтобы весь путь листка к центру был на виду
const LEAF_START = new THREE.Vector3(-LEAF_DEPTH * 0.75, LEAF_DEPTH * 0.12, LEAF_TRIGGER_Z - LEAF_DEPTH)
// крона дуба в модели: центр (0.2, 3.4), радиус ~1.45 — в мире умножаем на масштаб
// крона отодвинута: листок висит на тонкой веточке на тёмном фоне, а не на зелёной кроне
const LEAF_TREE = { scale: 1.7, pos: [LEAF_START.x - (0.2 + 2.3) * 1.7, -4, LEAF_START.z] }
const LEAF_TWIG_FROM = new THREE.Vector3(LEAF_TREE.pos[0] + (0.2 + 1.2) * 1.7, LEAF_START.y + 0.6, LEAF_START.z)

// птица-вестник раздела Projects. Когда камера доходит до точки срыва (BIRD_TRIGGER_Z), птица
// сидит на 18 единиц впереди в правой части кадра, чуть выше середины — на макушке дуба
const BIRD_STATION   = STATION_MARKS.find((s) => s.messenger === 'bird')
const BIRD_TRIGGER_Z = BIRD_STATION ? messengerTriggerZ(BIRD_STATION) : -350
const BIRD_DEPTH     = 18
const BIRD_PERCH = new THREE.Vector3(BIRD_DEPTH * 0.8, BIRD_DEPTH * 0.18, BIRD_TRIGGER_Z - BIRD_DEPTH)
// макушка кроны дуба в модели: (0.2, 4.8) — подбираем масштаб и место дерева под птицу
const PERCH_TREE_SCALE = (BIRD_PERCH.y + 4) / 4.8
const PERCH_TREE = { scale: PERCH_TREE_SCALE, pos: [BIRD_PERCH.x - 0.2 * PERCH_TREE_SCALE, -4, BIRD_PERCH.z] }
const FOREST_OBJECTS = buildForestLayout()

;[...new Set([...SEA_OBJECTS, ...BEACH_OBJECTS, ...FOREST_OBJECTS].map(o => o.url)), ASSET + 'models/forest_bird_fly.glb']
  .forEach(u => useGLTF.preload(u))

function sampleModel(scene, count) {
  let mesh = null
  scene.traverse(o => { if (o.isMesh && !mesh) mesh = o })
  // цвет берётся из атрибута 'color' (COLOR_0 из Blender) автоматически
  const sampler = new MeshSurfaceSampler(mesh).build()
  const positions = new Float32Array(count * 3)
  const colors    = new Float32Array(count * 3)
  const p = new THREE.Vector3(), c = new THREE.Color(1, 1, 1)
  for (let i = 0; i < count; i++) {
    sampler.sample(p, undefined, c)
    positions[i*3] = p.x; positions[i*3+1] = p.y; positions[i*3+2] = p.z
    // чуть ярче, чтобы bloom подхватывал
    colors[i*3] = c.r * 1.3; colors[i*3+1] = c.g * 1.3; colors[i*3+2] = c.b * 1.3
  }
  return { positions, colors }
}

// lock: 0…1 — насколько луч маяка сейчас «держит» камеру (BeamMessenger); обычный вращающийся
// луч на это время гаснет
const lighthouseState = { lock: 0 }

function LighthouseBeam() {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#fff2a8'), [])
  const geo = useMemo(() => {
    const count = 500; const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1
      const d = Math.pow(Math.random(), 0.7) * 14
      const spread = d * 0.09
      arr[i*3]   = side * d
      arr[i*3+1] = (Math.random() - 0.5) * spread
      arr[i*3+2] = (Math.random() - 0.5) * spread
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.getElapsedTime() * 0.9
    ref.current.material.opacity = 0.55 * (1 - lighthouseState.lock)
  })
  return (
    // фонарь маяка в координатах модели
    <points ref={ref} geometry={geo} position={[0.3, 4.98, 0]}>
      <pointsMaterial map={tex} size={0.12} sizeAttenuation alphaTest={0.05}
        transparent opacity={0.55} depthWrite={false} color="#fff2a8" />
    </points>
  )
}

// ─── Прыжок дельфинов через линию пути ───────────────────────────────────────
// Все дельфины прыгают в одном месте по одной дуге «паровозиком»: с отставанием
// LEAP_STAGGER друг от друга (leapDelay = 0, 1, 2…). Прыжок запускается остановкой
// камеры перед ними, до этого дельфины скрыты. Вылетают слева от пути и ныряют справа.
const LEAP_JUMP     = 1.6                      // с — один прыжок
const LEAP_STAGGER  = 0.45                     // с — отставание следующего дельфина
const LEAP_HALF     = 9                        // полуширина прыжка поперёк пути
const LEAP_HEIGHT   = 3.2
const WATER_Y       = -4

// Камера замирает перед дельфинами: при пересечении DOLPHIN_STOP_Z вперёд
// она стоит DOLPHIN_STOP_TIME секунд, а «паровозик» стартует ровно в этот момент
const DOLPHIN_STOP_TIME = 2 * LEAP_STAGGER + LEAP_JUMP + 0.7
// время старта «паровозика» (clock.elapsedTime); до первой остановки камеры дельфины скрыты,
// и на каждую остановку они прыгают один раз
const dolphinShow = { start: -Infinity }

const _leapNext = new THREE.Vector3()
const pathXAt = (z) => PATH_CURVE.getPoint(clamp((-10 - z) / 800, 0, 1)).x

// s ∈ [0,1] — прогресс прыжка, или -1 если дельфин под водой; tau — время с начала прыжка этого дельфина
function leapState(time, delay) {
  // один проход «паровозика» после остановки камеры; до и после — под водой (скрыты)
  const tau = time - dolphinShow.start - delay * LEAP_STAGGER
  return { tau, s: tau >= 0 && tau < LEAP_JUMP ? tau / LEAP_JUMP : -1 }
}

const SPLASH_PTS = 80   // капель на один всплеск; всплесков два — при выходе и при входе в воду
const SPLASH_TIME = 0.9
const _splashA = new THREE.Vector3(), _splashB = new THREE.Vector3()

function LeapSplash({ z, delay }) {
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#bfe8ff'), [])
  const pathX = useMemo(() => pathXAt(z), [z])
  const { geo, vel } = useMemo(() => {
    const vel = new Float32Array(SPLASH_PTS * 2 * 3)
    for (let i = 0; i < SPLASH_PTS * 2; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 1.6
      vel[i*3] = Math.cos(a) * r; vel[i*3+1] = 2.5 + Math.random() * 3.5; vel[i*3+2] = Math.sin(a) * r * 0.6
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPLASH_PTS * 2 * 3), 3))
    return { geo: g, vel }
  }, [])

  useFrame(({ clock, camera }) => {
    const p = ref.current; if (!p) return
    const dist = camera.position.z - z
    p.visible = dist < 150 && dist > -25
    if (!p.visible) return
    const { tau } = leapState(clock.getElapsedTime(), delay)
    const arr = p.geometry.attributes.position.array
    // [0] — выход из воды слева, [1] — вход справа
    let bursts = [[pathX - LEAP_HALF, tau, WATER_Y], [pathX + LEAP_HALF, tau - LEAP_JUMP, WATER_Y]]
    const path = getPath('dolphins')
    if (path && path.length > 1) {
      const fl = { path }
      const a = pathFlightPos(fl, 0, dist, camera, _splashA), b2 = pathFlightPos(fl, 1, dist, camera, _splashB)
      bursts = [[a.x, tau, a.y], [b2.x, tau - LEAP_JUMP, b2.y]]
    }
    bursts.forEach(([bx, bt, by], b) => {
      for (let i = b * SPLASH_PTS; i < (b + 1) * SPLASH_PTS; i++) {
        if (bt < 0 || bt > SPLASH_TIME) { arr[i*3+1] = -100; continue }   // спрятать под сцену
        arr[i*3]   = bx + vel[i*3] * bt
        arr[i*3+1] = by + vel[i*3+1] * bt - 6 * bt * bt
        arr[i*3+2] = z + vel[i*3+2] * bt
      }
    })
    p.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial map={tex} size={0.14} sizeAttenuation alphaTest={0.05}
        transparent opacity={0.85} depthWrite={false} color="#bfe8ff" />
    </points>
  )
}

// путь по воде из редактора: точки [x, z]; длина пути — для постоянной скорости
const waterRoute = new WeakMap()
function routeLength(path) {
  let len = waterRoute.get(path)
  if (len === undefined) {
    len = 0
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1])
    waterRoute.set(path, len)
  }
  return len
}
const _wp = { x: 0, y: 0 }, _wq = { x: 0, y: 0 }
const ROUTE_START_DIST = 60   // модель вне цепочки трогается, когда камера в стольких единицах от неё
const ROUTE_FORCE_DIST = 18   // модель из цепочки трогается без очереди, если камера подлетела вплотную

// самое большое отставание провожатых для каждого пути — чтобы знать, когда растаял последний
const ROUTE_MAX_GAP = {}
for (const o of SEA_OBJECTS) if (o.pathId) ROUTE_MAX_GAP[o.pathId] = Math.max(ROUTE_MAX_GAP[o.pathId] ?? 0, o.follow?.gap ?? 0)

// когда (performance.now() / 1000) путь pathId пройден целиком, включая провожатых; null — ещё нет
function routeEndAt(pathId) {
  if (routeStart[pathId] === undefined || routeHold[pathId]) return null
  const route = getPath(pathId)
  if (!route || route.length < 2) return routeStart[pathId]          // без своего пути — сразу «готово»
  const len = Math.max(routeLength(route), 0.1)
  return routeStart[pathId] + (WATER_MODELS[pathId]?.duration ?? 12) * (len + (ROUTE_MAX_GAP[pathId] ?? 0)) / len
}

// пора ли трогаться модели из морской цепочки
function chainReady(pathId, now) {
  const i = SEA_CHAIN.indexOf(pathId)
  if (i < 0) return null                                             // не в цепочке
  if (i === 0) return seaChain.dolphinsDoneAt !== null && now >= seaChain.dolphinsDoneAt
  const prev = routeEndAt(SEA_CHAIN[i - 1])
  return prev !== null && now >= prev
}

function ParticleModel({ url, pos, rot, scale, count, anim, phase = 0, leapDelay = 0, pathId, follow }) {
  const { scene } = useGLTF(url)
  const groupRef = useRef()
  const ptsRef   = useRef()
  const lastK    = useRef(-1)
  const tex = useMemo(() => makeCircleTex('#ffffff'), [])
  const pathX = useMemo(() => pathXAt(pos[2]), [pos])

  const { geo, target, scatter } = useMemo(() => {
    const { positions, colors } = sampleModel(scene, count)
    const scatter = new Float32Array(count * 3)
    const v = new THREE.Vector3()
    // scale — число или [x, y, z] (деревья растягиваются по высоте/ширине отдельно);
    // облако разлёта делим на масштаб по каждой оси, чтобы в мире оно было одного размера
    const [sx, sy, sz] = Array.isArray(scale) ? scale : [scale, scale, scale]
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(6 + Math.random() * 16)
      scatter[i*3] = v.x / sx; scatter[i*3+1] = v.y / sy; scatter[i*3+2] = v.z / sz
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3))
    g.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
    return { geo: g, target: positions, scatter }
  }, [scene, count, scale])

  useFrame(({ clock, camera }) => {
    const g = groupRef.current; const pts = ptsRef.current
    if (!g || !pts) return
    const dist = camera.position.z - pos[2]           // > 0 — объект впереди
    g.visible = dist < 150 && dist > -25
    if (!g.visible) return

    // сборка: на 130 ед. — облако, к 45 ед. — фигура
    const k    = clamp(1 - (dist - 45) / 85, 0, 1)
    const ease = 1 - Math.pow(1 - k, 3)
    const fadeIn = clamp((150 - dist) / 30, 0, 1)
    pts.material.opacity = fadeIn * (0.3 + 0.7 * ease)
    if (Math.abs(ease - lastK.current) > 0.001) {
      const a = pts.geometry.attributes.position.array
      const s = 1 - ease
      for (let i = 0; i < a.length; i++) a[i] = target[i] + scatter[i] * s
      pts.geometry.attributes.position.needsUpdate = true
      lastK.current = ease
    }

    const t = clock.getElapsedTime() + phase
    g.position.set(pos[0], pos[1], pos[2])
    g.rotation.set(rot[0], rot[1], rot[2])
    // свой путь по воде (редактор): ждёт в начале пути, когда камера подлетает — плывёт ОДИН раз
    // до конца (нос по ходу) и мягко тает. Улетели назад, и модель скрылась — снова ждёт в начале.
    // Покачивание (bob) добавляется ниже, как обычно.
    const route = pathId && getPath(pathId)
    if (route && route.length > 1) {
      const now = performance.now() / 1000
      if (dist > 140) delete routeStart[pathId]                          // далеко позади — сброс
      else if (routeStart[pathId] === undefined) {
        const ready = chainReady(pathId, now)
        if (ready === null ? dist < ROUTE_START_DIST : (ready || dist < ROUTE_FORCE_DIST)) routeStart[pathId] = now
      }
      const len = Math.max(routeLength(route), 0.1)
      // в редакторе, пока объект выбран и не нажато «Проиграть», стоит в начале пути
      const since = routeStart[pathId] === undefined || routeHold[pathId] ? 0 : now - routeStart[pathId]
      // сопровождающие отстают на follow.gap единиц пути: до старта стоят позади начала пути
      const travelled = (since / (WATER_MODELS[pathId]?.duration ?? 12)) * len - (follow?.gap ?? 0)
      const u = clamp(travelled / len, 0, 1)
      if (u >= 1) { g.visible = false; return }                             // доплыл и растаял
      samplePath(route, u, _wp)
      // направление: на следующую точку пути (у самого конца — от предыдущей)
      if (u < 0.99) samplePath(route, u + 0.01, _wq)
      else { samplePath(route, u - 0.01, _wq); _wq.x = 2 * _wp.x - _wq.x; _wq.y = 2 * _wp.y - _wq.y }
      if (follow) {
        const dx = _wq.x - _wp.x, dz = _wq.y - _wp.y, dl = Math.hypot(dx, dz) || 1
        const back = Math.min(travelled, 0)                                  // ещё не дошёл до начала пути
        // перпендикуляр к курсу, повёрнутый в сторону от камеры (плавно, без скачка, когда
        // курс идёт прямо на камеру)
        let nx = -dz / dl, nz = dx / dl
        const cx = camera.position.x - _wp.x, cz = camera.position.z - _wp.y, cl = Math.hypot(cx, cz) || 1
        const away = -clamp(((nx * cx + nz * cz) / cl) * 4, -1, 1)
        nx *= away * follow.side; nz *= away * follow.side
        const px = _wp.x + (dx / dl) * back + nx
        const pz = _wp.y + (dz / dl) * back + nz
        _wq.x += px - _wp.x; _wq.y += pz - _wp.y; _wp.x = px; _wp.y = pz
      }
      g.position.x = _wp.x; g.position.z = _wp.y
      // модели смотрят вдоль +X: поворот вокруг Y к направлению движения
      if (Math.hypot(_wq.x - _wp.x, _wq.y - _wp.y) > 1e-4) g.rotation.y = Math.atan2(-(_wq.y - _wp.y), _wq.x - _wp.x) + (WATER_MODELS[pathId]?.heading ?? 0)
      // на последней пятой части пути мягко тает
      pts.material.opacity *= 1 - THREE.MathUtils.smoothstep(u, 0.8, 1)
    }
    if (anim === 'bob' || anim === 'beam') {
      if (anim === 'bob') {
        g.position.y += Math.sin(t * 0.9) * 0.15
        g.rotation.z += Math.sin(t * 0.7) * 0.04
        g.rotation.x += Math.sin(t * 0.55) * 0.03
      }
    } else if (anim === 'leap') {
      // дуга поперёк пути слева направо; нос повёрнут по касательной к дуге
      const { s } = leapState(clock.getElapsedTime(), leapDelay)
      if (s < 0) { g.visible = false; return }
      const path = getPath('dolphins')
      if (path && path.length > 1) {
        // на экране — по нарисованной линии, на глубине самих дельфинов; нос — по касательной
        const fl = { path }, d = camera.position.z - pos[2]
        pathFlightPos(fl, s, d, camera, g.position)
        pathFlightPos(fl, Math.min(s + 0.02, 1), d, camera, _leapNext)
        if (s >= 0.98) pathFlightPos(fl, s - 0.02, d, camera, _leapNext).sub(g.position).negate().add(g.position)
        const dx = _leapNext.x - g.position.x, dy = _leapNext.y - g.position.y
        const back = path[path.length - 1][0] < path[0][0]       // нарисовано справа налево — разворот
        if (back) g.rotation.y += Math.PI
        g.rotation.z = back ? Math.atan2(dy, -dx) : Math.atan2(dy, dx)
        return
      }
      g.position.x = pathX - LEAP_HALF + 2 * LEAP_HALF * s
      g.position.y = pos[1] + LEAP_HEIGHT * Math.sin(Math.PI * s)
      g.rotation.z = Math.atan2(LEAP_HEIGHT * Math.PI * Math.cos(Math.PI * s), 2 * LEAP_HALF)
    } else if (anim === 'swim') {
      if (!(route && route.length > 1)) g.position.x += Math.sin(t * 0.25) * 2.5
      g.position.y += Math.sin(t * 0.8) * 0.12
      if (!(route && route.length > 1)) g.rotation.y += Math.cos(t * 0.25) * 0.35
      g.rotation.z += Math.sin(t * 1.2) * 0.05
    } else if (anim === 'spin') {
      g.rotation.y += t * 0.25
      g.position.y += Math.sin(t * 0.7) * 0.08
    } else if (anim === 'sway') {
      // пальма покачивается на ветру
      g.rotation.z += Math.sin(t * 0.6) * 0.03
      g.rotation.x += Math.sin(t * 0.45) * 0.015
    } else if (anim === 'drift') {
      // облако медленно плывёт
      g.position.x += Math.sin(t * 0.07) * 4
      g.position.y += Math.sin(t * 0.3) * 0.3
    }
  })

  return (
    <>
      <group ref={groupRef} position={pos} rotation={rot} scale={scale}>
        <points ref={ptsRef} geometry={geo}>
          <pointsMaterial map={tex} vertexColors size={0.13} sizeAttenuation alphaTest={0.05}
            transparent opacity={0} depthWrite={false} />
        </points>
        {anim === 'beam' && <LighthouseBeam />}
      </group>
      {anim === 'leap' && <LeapSplash z={pos[2]} delay={leapDelay} />}
    </>
  )
}

function SeaObjects() {
  // одна модель может стоять несколько раз (дельфины) — ключ по индексу
  return SEA_OBJECTS.map((o, i) => <ParticleModel key={`${o.url}-${i}`} {...o} phase={i * 1.7} />)
}

function ForestObjects() {
  return FOREST_OBJECTS.map((o, i) => <ParticleModel key={`${o.url}-${i}`} {...o} phase={i * 0.9} />)
}

function BeachObjects() {
  // одна модель может стоять несколько раз (две пальмы) — ключ по индексу
  return BEACH_OBJECTS.map((o, i) => <ParticleModel key={`${o.url}-${i}`} {...o} phase={i * 1.3} />)
}

// ─── Пляж (оранжево-жёлтый песок) ────────────────────────────────────────────

function Beach() {
  const sandRef  = useRef()
  const shoreRef = useRef()
  const sandTex  = useMemo(() => makeCircleTex('#e8c97a'), [])
  const shoreTex = useMemo(() => makeCircleTex('#aaddff'), [])

  const sandGeo = useMemo(() => {
    const count = 10000; const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const x = (Math.random()-0.5)*100
      arr[i*3]   = x; arr[i*3+1] = -4 + (Math.random()-0.5)*0.2
      arr[i*3+2] = shoreEdgeZ(x) - Math.random() * (SHORE_Z - SAND_END_Z)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])

  // Горячий песок — чуть более оранжевые точки
  const hotSandGeo = useMemo(() => {
    const count = 4000; const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const x = (Math.random()-0.5)*90
      arr[i*3]   = x; arr[i*3+1] = -3.9 + Math.random()*0.3
      arr[i*3+2] = shoreEdgeZ(x) - 3 - Math.random() * (SHORE_Z - SAND_END_Z - 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  const hotTex = useMemo(() => makeCircleTex('#ffaa44'), [])
  const hotRef = useRef()

  // Линия прибоя
  const shoreGeo = useMemo(() => {
    const pts = []
    for (let i = 0; i < 700; i++) {
      const x = -50 + (i / 700) * 100
      // пена у самой кромки и второй, более редкий ряд чуть дальше в воде
      pts.push(x, -3.85 + Math.random()*0.15, shoreEdgeZ(x) + Math.random()*0.4)
      if (i % 2) pts.push(x + (Math.random()-0.5), -3.85 + Math.random()*0.2, shoreEdgeZ(x) + 1.2 + Math.random()*0.8)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    return g
  }, [])


  useFrame(({ clock, camera }) => {
    const bp = beachProgress(camera.position.z); const t = clock.getElapsedTime()
    const op = clamp(bp * 2, 0, 1)
    if (sandRef.current)  { sandRef.current.material.opacity  = op * 0.8;  sandRef.current.visible  = bp > 0.01 }
    if (hotRef.current)   { hotRef.current.material.opacity   = op * 0.7 * (0.7 + 0.3*Math.sin(t*1.1));  hotRef.current.visible = bp > 0.01 }
    if (shoreRef.current) { shoreRef.current.material.opacity = op * 0.85 * (0.7 + 0.3*Math.sin(t*1.6)); shoreRef.current.visible = bp > 0.01 }
  })

  return (
    <>
      <points ref={sandRef}  geometry={sandGeo}>  <pointsMaterial map={sandTex}  size={0.18} sizeAttenuation alphaTest={0.05} transparent opacity={0} depthWrite={false} color="#e8c97a" /></points>
      <points ref={hotRef}   geometry={hotSandGeo}><pointsMaterial map={hotTex}   size={0.22} sizeAttenuation alphaTest={0.05} transparent opacity={0} depthWrite={false} color="#ffaa44" /></points>
      <points ref={shoreRef} geometry={shoreGeo}> <pointsMaterial map={shoreTex} size={0.25} sizeAttenuation alphaTest={0.05} transparent opacity={0} depthWrite={false} color="#aaddff" /></points>
    </>
  )
}

// ─── Звёзды-вестники станций ─────────────────────────────────────────────────
// Когда камера подлетает к станции, звезда вылетает из-за правого края экрана
// и по спирали идёт к центру, где вспыхивает ровно в момент, когда Overlay
// открывает панель (cameraZ = triggerZ + STATION_RANGE). При полёте назад —
// раскручивается обратно за край экрана.

const STAR_POINT   = 0.9          // звезда — ОДНА светящаяся точка; её размер = STAR_POINT × масштаб
const BURST_PTS    = 220            // на столько точек звезда рассыпается у камеры
const STAR_END_SCALE = 1.3            // размер звезды у камеры — к прибытию она растёт до него
const FLIGHT_LEN   = 40    // сколько единиц пути длится перелёт звезды
const SPIRAL_R0    = 17    // стартовый радиус — за правым краем кадра
const SPIRAL_Z0    = 14    // стартовая глубина перед камерой
const SPIRAL_TURNS = 1.25
// режим 'far': звезда висит вдали и летит на зрителя по объёмному штопору
const FAR_DEPTH    = 110   // стартовая дальность от камеры
const FAR_RADIUS   = 12    // радиус витка в мире: вдали на экране он узкий, вблизи раскрывается
const FAR_TURNS    = 1.5
const FAR_APPROACH   = 0.2  // доля пути, когда звезда только приближается, без вращения
const FAR_SPIN_DEPTH = 60   // на какой дальности начинается вращение
const CAM_START_Z  = 5     // откуда камера стартует после «Enter Space»

function makeStarGeometry() {
  // звезда — одна круглая светящаяся точка; растёт по мере приближения, у камеры рассыпается
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
  return g
}

// откуда начинает звезда в режиме far: доля от дальности (на экране — почти угол кадра)
const FAR_ORIGINS = { center: [0, 0], topLeft: [-1.05, 0.62] }
const FAR_FLIGHT = 55           // единиц пути на перелёт звезды из глубины
const FAR_APPEAR = 60           // за сколько единиц до начала перелёта звезда появляется вдали

function StationStar({ id, triggerZ, color, side, flight, from = 'center' }) {
  const starRef  = useRef()
  const burstRef = useRef()
  const tex      = useMemo(() => makeCircleTex('#ffffff'), [])
  const starGeo  = useMemo(makeStarGeometry, [])
  const burst    = useMemo(() => {
    const dirs = new Float32Array(BURST_PTS * 3)
    for (let i = 0; i < BURST_PTS; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(0.6 + Math.random())
      dirs[i*3] = v.x; dirs[i*3+1] = v.y; dirs[i*3+2] = v.z * 0.3
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_PTS * 3), 3))
    return { geo: g, dirs }
  }, [])
  const state = useRef({ prevT: 0, burstAt: -1 })
  const _dest = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ clock, camera }) => {
    const star = starRef.current, b = burstRef.current
    if (!star || !b) return
    const time = clock.getElapsedTime()
    const camZ = camera.position.z
    const arriveZ = triggerZ + STATION_RANGE
    // перелёт не может начаться раньше старта камеры (важно для первой станции)
    const startZ = Math.min(arriveZ + (flight === 'far' ? FAR_FLIGHT : FLIGHT_LEN), CAM_START_Z)
    const t = clamp((startZ - camZ) / (startZ - arriveZ), 0, 1)

    // точка перед камерой, куда она прилетает
    _dest.set(camera.position.x, camera.position.y - 0.1, camZ - 4)

    const pulse = 1 + Math.sin(time * 4 + side) * 0.12
    let a
    if (flight === 'far') {
      // 1) первые FAR_APPROACH пути — летит прямо на зрителя без вращения: из центра или
      //    из угла (from) по прямой к центру;
      // 2) затем штопор: радиус плавно растёт от нуля и к прибытию сходится к центру,
      //    перспектива раскрывает витки по мере приближения
      const e = t
      let depth, r, offX = 0, offY = 0
      if (e < FAR_APPROACH) {
        const s = e / FAR_APPROACH
        depth = FAR_DEPTH + (FAR_SPIN_DEPTH - FAR_DEPTH) * s
        r = 0
        a = Math.PI * 0.25
        const [ox, oy] = FAR_ORIGINS[from] ?? FAR_ORIGINS.center
        offX = ox * depth * (1 - s); offY = oy * depth * (1 - s)
      } else {
        const s = (e - FAR_APPROACH) / (1 - FAR_APPROACH)
        depth = 4 + (FAR_SPIN_DEPTH - 4) * Math.pow(1 - s, 1.3)
        r = FAR_RADIUS * Math.sin(Math.PI * s) * (1 - s * 0.35)
        a = Math.PI * 0.25 + s * Math.PI * 2 * FAR_TURNS
      }
      star.position.set(
        camera.position.x + Math.cos(a) * r + offX,
        camera.position.y - 0.1 + Math.sin(a) * r * 0.7 + offY,
        camZ - depth
      )
      // вдали крупнее, чтобы была заметна; на экране всё равно растёт — перспектива сильнее
      star.scale.setScalar((3.2 + (STAR_END_SCALE - 3.2) * e) * pulse)
      star.material.size = STAR_POINT * star.scale.x
      // вдали появляется плавно, незадолго до начала перелёта
      const appear = clamp((startZ + FAR_APPEAR - camZ) / 20, 0, 1)
      star.visible = t < 1 && appear > 0.01
      star.material.opacity = appear
    } else {
      // из-за правого края экрана: радиус сжимается к центру, ~1.25 оборота
      const e = 1 - (1 - t) * (1 - t)
      const r = SPIRAL_R0 * Math.pow(1 - e, 1.15)
      a = e * Math.PI * 2 * SPIRAL_TURNS
      const depth = SPIRAL_Z0 + (4 - SPIRAL_Z0) * e    // от 14 до 4 единиц перед камерой
      star.position.set(
        camera.position.x + Math.cos(a) * r,
        camera.position.y - 0.1 + Math.sin(a) * r * 0.7,
        camZ - depth
      )
      star.scale.setScalar((0.9 + (STAR_END_SCALE - 0.9) * e) * pulse)   // растёт на подлёте
      star.material.size = STAR_POINT * star.scale.x
      star.visible = t > 0 && t < 1
      star.material.opacity = clamp(t * 6, 0, 1)
    }
    // своя траектория из редактора: на экране — по линии, по глубине — как обычно (из глубины к камере)
    const path = getPath(id)
    if (path && path.length > 1) {
      const fl = { path }
      const depth = flight === 'far' ? 4 + (FAR_DEPTH - 4) * Math.pow(1 - t, 1.6) : SPIRAL_Z0 + (4 - SPIRAL_Z0) * (1 - (1 - t) * (1 - t))
      pathFlightPos(fl, t, depth, camera, star.position)
      pathFlightPos(fl, 1, 4, camera, _dest)      // там же и рассыпается
    }
    star.rotation.z = time * 0.6 + a

    // вспышка — только при пересечении точки прибытия вперёд
    const st = state.current
    if (st.prevT < 1 && t >= 1) st.burstAt = time
    st.prevT = t
    const bt = st.burstAt < 0 ? 1 : (time - st.burstAt) / 0.9
    b.visible = bt < 1
    if (b.visible) {
      const pos = b.geometry.attributes.position.array
      const r = 0.15 + (1 - Math.pow(1 - bt, 3)) * 3.5
      for (let i = 0; i < BURST_PTS * 3; i++) pos[i] = burst.dirs[i] * r
      b.geometry.attributes.position.needsUpdate = true
      b.position.copy(_dest)
      b.material.opacity = 1 - bt
    }
  })

  return (
    <>
      <points ref={starRef} geometry={starGeo}>
        <pointsMaterial map={tex} size={STAR_POINT} sizeAttenuation alphaTest={0.02} transparent
          depthWrite={false} fog={false} color={color} blending={THREE.AdditiveBlending} />
      </points>
      <points ref={burstRef} geometry={burst.geo} visible={false}>
        <pointsMaterial map={tex} size={0.1} sizeAttenuation alphaTest={0.02} transparent
          depthWrite={false} fog={false} color={color} blending={THREE.AdditiveBlending} />
      </points>
    </>
  )
}

function StationStars() {
  // у станций со star: false (Designs — её карточку «вызывают» дельфины) и с вестником-птицей звезды нет
  return STATION_MARKS.map((s, i) => (s.star === false || s.messenger) ? null : (
    <StationStar key={s.id} id={s.id} triggerZ={s.triggerZ} color={s.color} side={i % 2 ? 1 : -1} flight={s.flight} from={s.from} />
  ))
}

// ─── Птица-вестник ───────────────────────────────────────────────────────────
// Сидит на макушке дерева в правой части кадра (BIRD_PERCH), в профиль. Когда камера
// пересекает BIRD_TRIGGER_Z, птица срывается и дальше летит ПО ВРЕМЕНИ: справа налево к центру
// кадра, в профиль, машет крыльями; в центре зависает, тает — и сообщает onDone: карточка
// открывается сама. Если вернуться назад за точку срыва — птица снова сидит на дереве.
const BIRD_FLY   = 2.6         // с — перелёт к центру
const BIRD_HOVER = 0.6          // с — зависает в центре, машет крыльями
const BIRD_FADE  = 0.4          // с — тает
const BIRD_PERCH_SCALE = 2.6
const BIRD_NEAR_SCALE  = 1.5    // в центре кадра — в 6 единицах от камеры
const BIRD_LEFT = new THREE.Vector3(-1, 0, 0)

function BirdMessenger({ onDone, onReset }) {
  const { scene } = useGLTF(ASSET + 'models/forest_bird_fly.glb')
  const outerRef = useRef(), wingL = useRef(), wingR = useRef()
  const mats = useRef([])
  const tex = useMemo(() => makeCircleTex('#ffffff'), [])

  // тело и крылья — отдельные облака точек; крылья в своих группах с центром в «плече»
  const parts = useMemo(() => {
    const make = (name, count) => {
      const node = scene.getObjectByName(name)
      const { positions, colors } = sampleModel(node, count)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      g.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
      return { geo: g, pos: node.position.toArray() }
    }
    return { body: make('BirdBody', 1400), wl: make('WingL', 450), wr: make('WingR', 450) }
  }, [scene])

  const _dest = useMemo(() => new THREE.Vector3(), [])
  const _ctrl = useMemo(() => new THREE.Vector3(), [])
  const _look = useMemo(() => new THREE.Vector3(), [])
  const st = useRef({ startedAt: -1, prevZ: Infinity, done: false })
  // путь: от ветки к центру кадра по пологой дуге вверх (квадратичная кривая)
  const at = (e, out) => {
    const u = 1 - e
    return out.set(
      u*u*BIRD_PERCH.x + 2*u*e*_ctrl.x + e*e*_dest.x,
      u*u*BIRD_PERCH.y + 2*u*e*_ctrl.y + e*e*_dest.y,
      u*u*BIRD_PERCH.z + 2*u*e*_ctrl.z + e*e*_dest.z)
  }

  useFrame(({ clock, camera }) => {
    const g = outerRef.current; if (!g) return
    const time = clock.getElapsedTime()
    const camZ = camera.position.z
    const s = st.current
    // срывается только при обычном пролёте, не при переносе камеры (навигация, редактор)
    if (s.startedAt < 0 && s.prevZ > BIRD_TRIGGER_Z && camZ <= BIRD_TRIGGER_Z && !camTeleport.pending) {
      s.startedAt = time
      s.fl = startPathFlight('bird', BIRD_PERCH, camera)
      s.face = -1
    }
    if (s.startedAt >= 0 && camZ > BIRD_TRIGGER_Z + 1) {
      s.startedAt = -1
      if (s.done) { s.done = false; onReset?.() }
    }
    s.prevZ = camZ

    const setOpacity = (o) => { for (const m of mats.current) if (m) m.opacity = o }
    if (s.startedAt < 0) {
      // сидит на ветке в профиль (смотрит влево — туда, куда полетит), изредка подпрыгивает
      const dist = camZ - BIRD_PERCH.z
      g.visible = dist < 170 && dist > -5
      if (!g.visible) return
      setOpacity(clamp((170 - dist) / 30, 0, 1))
      const c = time % 3
      g.position.copy(BIRD_PERCH)
      g.position.y += c < 0.4 ? Math.sin((c / 0.4) * Math.PI) * 0.4 : 0
      g.lookAt(_look.copy(g.position).add(BIRD_LEFT))
      wingL.current.rotation.x = -1.1; wingR.current.rotation.x = 1.1
      g.scale.setScalar(BIRD_PERCH_SCALE)
      return
    }

    const el = time - s.startedAt
    if (el > BIRD_FLY + BIRD_HOVER + BIRD_FADE) {
      g.visible = false
      if (!s.done) { s.done = true; onDone?.() }
      return
    }
    g.visible = true
    // центр кадра — в 6 единицах перед камерой (камера может продолжать лететь)
    _dest.set(camera.position.x, camera.position.y - 0.2, camZ - 6)
    _ctrl.lerpVectors(BIRD_PERCH, _dest, 0.5); _ctrl.y += 2
    const f = Math.min(el / BIRD_FLY, 1)
    const e = 1 - Math.pow(1 - f, 3)                       // плавно тормозит к центру
    if (s.fl) {
      // нарисованный путь: в профиль, головой туда, куда сейчас летит по экрану
      pathFlightPos(s.fl, e, s.fl.startDepth + (6 - s.fl.startDepth) * e, camera, g.position)
      if (e < 0.98) {
        const x0 = samplePath(s.fl.path, e, _pp).x, x1 = samplePath(s.fl.path, Math.min(e + 0.03, 1), _pp).x
        if (Math.abs(x1 - x0) > 0.002) s.face = Math.sign(x1 - x0)
      }
    } else at(e, g.position)
    g.position.y += Math.sin(el * 7) * 0.12                 // взмахи чуть качают корпус
    // в профиль: смотрит по ходу полёта (по умолчанию влево), без разворота к камере
    g.lookAt(_look.copy(g.position).addScaledVector(BIRD_LEFT, s.fl ? -s.face : 1))
    const flap = Math.sin(time * 16) * 0.85
    wingL.current.rotation.x = flap; wingR.current.rotation.x = -flap
    g.scale.setScalar(BIRD_PERCH_SCALE + (BIRD_NEAR_SCALE - BIRD_PERCH_SCALE) * e)
    // зависает, затем тает
    const fade = clamp((el - BIRD_FLY - BIRD_HOVER) / BIRD_FADE, 0, 1)
    setOpacity(1 - fade)
  })

  const mat = (i) => (
    <pointsMaterial ref={(m) => { mats.current[i] = m }} map={tex} vertexColors size={0.12}
      sizeAttenuation alphaTest={0.05} transparent depthWrite={false} />
  )
  return (
    <group ref={outerRef}>
      {/* модель смотрит вдоль +X; lookAt разворачивает группу осью +Z к цели — поворачиваем модель */}
      <group rotation={[0, -Math.PI / 2, 0]}>
        <points geometry={parts.body.geo}>{mat(0)}</points>
        <group ref={wingL} position={parts.wl.pos}><points geometry={parts.wl.geo}>{mat(1)}</points></group>
        <group ref={wingR} position={parts.wr.pos}><points geometry={parts.wr.geo}>{mat(2)}</points></group>
      </group>
    </group>
  )
}

// ─── Листок-вестник ──────────────────────────────────────────────────────────
// Висит на краю кроны (LEAF_START). Когда камера пересекает LEAF_TRIGGER_Z, листок срывается
// и дальше летит ПО ВРЕМЕНИ (не зависит от того, движется ли камера): по изогнутой
// траектории — сначала проседает, потом подлетает — к центру кадра, слегка вращаясь;
// там плавно останавливается, зависает и тает. В этот момент сообщает onDone, и карточка
// открывается сама. Если вернуться назад за точку срыва — листок снова висит на ветке.
const LEAF_FLY   = 2.8          // с — полёт до центра
const LEAF_HOVER = 0.5          // с — зависает в центре
const LEAF_FADE  = 0.4          // с — тает
const LEAF_PTS = 600

function makeLeafGeometry() {
  // лист вдоль +X: заострённый эллипс, средняя жилка и черешок; приглушённые зелёные точки
  // и немного жёлтых, как в листве леса
  const pos = new Float32Array(LEAF_PTS * 3), col = new Float32Array(LEAF_PTS * 3)
  const green = new THREE.Color('#74a85a'), yellow = new THREE.Color('#cdd062'), vein = new THREE.Color('#4f7f3f')
  const c = new THREE.Color()
  for (let i = 0; i < LEAF_PTS; i++) {
    let x, y, edge
    if (i < 40) {                    // средняя жилка
      x = -0.5 + Math.random(); y = 0; edge = 0; c.copy(vein)
    } else if (i < 52) {             // черешок
      x = -0.5 - Math.random() * 0.25; y = 0; edge = 0; c.copy(vein)
    } else {                         // пластина листа: |y| < ширина в точке x
      x = -0.5 + Math.random()
      const w = 0.32 * Math.pow(Math.sin(Math.PI * (x + 0.5)), 0.8)
      y = (Math.random() * 2 - 1) * w
      edge = w > 0 ? Math.abs(y) / w : 0
      c.copy(green).lerp(yellow, Math.random() < 0.2 ? 0.85 : edge * edge * 0.4)
    }
    pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = 0.04 * Math.sin(Math.PI * (x + 0.5)) * (1 - edge)
    col[i*3] = c.r * 1.55; col[i*3+1] = c.g * 1.55; col[i*3+2] = c.b * 1.55   // ярче, чтобы читался в лесу
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color',    new THREE.BufferAttribute(col, 3))
  return g
}

function makeTwigGeometry() {
  const n = 60, arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    arr[i*3]   = LEAF_TWIG_FROM.x + (LEAF_START.x - LEAF_TWIG_FROM.x) * t
    arr[i*3+1] = LEAF_TWIG_FROM.y + (LEAF_START.y - LEAF_TWIG_FROM.y) * t + Math.sin(Math.PI * t) * 0.25
    arr[i*3+2] = LEAF_START.z
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  return g
}

function LeafMessenger({ onDone, onReset }) {
  const ref = useRef()
  const twigRef = useRef()
  const twigGeo = useMemo(makeTwigGeometry, [])
  const tex = useMemo(() => makeCircleTex('#ffffff'), [])
  const geo = useMemo(makeLeafGeometry, [])
  const _dest = useMemo(() => new THREE.Vector3(), [])
  const _ctrl = useMemo(() => new THREE.Vector3(), [])
  const st = useRef({ startedAt: -1, prevZ: Infinity, done: false })

  useFrame(({ clock, camera }) => {
    const leaf = ref.current; if (!leaf) return
    const time = clock.getElapsedTime()
    const camZ = camera.position.z
    const s = st.current

    // пересекли точку срыва вперёд — листок полетел; вернулись назад — снова на ветке
    // срывается только при обычном пролёте, не при переносе камеры (навигация, редактор)
    if (s.startedAt < 0 && s.prevZ > LEAF_TRIGGER_Z && camZ <= LEAF_TRIGGER_Z && !camTeleport.pending) {
      s.startedAt = time
      s.fl = startPathFlight('leaf', LEAF_START, camera)
    }
    if (s.startedAt >= 0 && camZ > LEAF_TRIGGER_Z + 1) {
      s.startedAt = -1
      if (s.done) { s.done = false; onReset?.() }
    }
    s.prevZ = camZ

    const dist = camZ - LEAF_START.z
    if (twigRef.current) twigRef.current.visible = dist < 160 && dist > -5
    if (s.startedAt < 0) {
      // висит на ветке и чуть покачивается
      leaf.visible = dist < 160 && dist > -5
      if (!leaf.visible) return
      leaf.material.opacity = clamp((160 - dist) / 30, 0, 1)
      leaf.position.copy(LEAF_START)
      leaf.rotation.set(0.4, 0, -0.9 + Math.sin(time * 1.5) * 0.15)
      leaf.scale.setScalar(3.2)
      // мягко мерцает (свечение bloom), чтобы его было видно среди листвы ещё до срыва
      leaf.material.color.setScalar(1.3 + 0.5 * Math.sin(time * 2.4))
      return
    }
    leaf.material.color.setScalar(1.3)

    const el = time - s.startedAt
    if (el > LEAF_FLY + LEAF_HOVER + LEAF_FADE) {
      leaf.visible = false
      if (!s.done) { s.done = true; onDone?.() }
      return
    }
    leaf.visible = true
    // центр кадра — в 4 единицах перед камерой (камера может продолжать лететь)
    _dest.set(camera.position.x, camera.position.y - 0.1, camZ - 4)
    const f = Math.min(el / LEAF_FLY, 1)
    const e = 1 - Math.pow(1 - f, 3)                     // плавно тормозит к центру
    // изогнутая траектория: опорная точка ниже середины пути — лист сначала проседает
    _ctrl.lerpVectors(LEAF_START, _dest, 0.45)
    _ctrl.y -= 3.2; _ctrl.x += 1.5
    const u = 1 - e
    if (s.fl) pathFlightPos(s.fl, e, s.fl.startDepth + (4 - s.fl.startDepth) * e, camera, leaf.position)
    else leaf.position.set(
      u*u*LEAF_START.x + 2*u*e*_ctrl.x + e*e*_dest.x,
      u*u*LEAF_START.y + 2*u*e*_ctrl.y + e*e*_dest.y,
      u*u*LEAF_START.z + 2*u*e*_ctrl.z + e*e*_dest.z)
    // лёгкое покачивание в полёте, затухающее к остановке
    leaf.position.x += Math.sin(el * 5) * 0.25 * (1 - e)
    // немного вращается; в центре — почти замирает
    const spin = 1 - e * 0.8
    leaf.rotation.set(0.4 + Math.sin(el * 2.2) * 0.5 * spin, el * 0.9 * spin, -0.9 + Math.sin(el * 3) * 0.35 * spin)
    leaf.scale.setScalar(3.2 + (0.7 - 3.2) * e)
    // зависает, затем тает
    const fade = clamp((el - LEAF_FLY - LEAF_HOVER) / LEAF_FADE, 0, 1)
    leaf.material.opacity = 1 - fade
    if (fade > 0) leaf.scale.multiplyScalar(1 - 0.3 * fade)
  })

  return (
    <>
      <points ref={ref} geometry={geo}>
        <pointsMaterial map={tex} vertexColors size={0.11} sizeAttenuation alphaTest={0.05}
          transparent depthWrite={false} />
      </points>
      <points ref={twigRef} geometry={twigGeo}>
        <pointsMaterial map={tex} size={0.09} sizeAttenuation alphaTest={0.05}
          transparent depthWrite={false} color="#7a5232" />
      </points>
    </>
  )
}

// ─── Луч маяка — вестник раздела Designs II ─────────────────────────────────
// Камера пересекает BEAM_TRIGGER_Z (маяк впереди слева) → луч проворачивается со стороны моря,
// наводится на камеру и держит её BEAM_HOLD секунд (камера может лететь дальше — луч следит),
// экран заливает тёплый свет → через BEAM_CARD_AT onDone: карточка открывается сама, пока мы ещё
// в луче → луч уходит дальше по кругу.
// Вернулись назад за точку срыва — всё сначала.
const BEAM_STATION   = STATION_MARKS.find((s) => s.messenger === 'beam')
const BEAM_TRIGGER_Z = BEAM_STATION ? messengerTriggerZ(BEAM_STATION) : -585
const BEAM_WAIT    = 0.4    // с — луч ещё крутится как обычно
const BEAM_SWEEP   = 1.6    // с — доворачивает на камеру
const BEAM_HOLD    = 4      // с — мы в луче
const BEAM_CARD_AT = 1.0    // с от начала «в луче» — открывается карточка (луч держит дальше)
const BEAM_RELEASE = 1.4    // с — уходит дальше
const BEAM_PTS     = 2600
const LIGHTHOUSE_OBJ = SEA_OBJECTS.find((o) => o.anim === 'beam')
// фонарь маяка в мировых координатах (в модели — [0.3, 4.98, 0], как у LighthouseBeam)
const LANTERN = new THREE.Vector3(0.3, 4.98, 0)
  .multiplyScalar(LIGHTHOUSE_OBJ.scale)
  .applyEuler(new THREE.Euler(...LIGHTHOUSE_OBJ.rot))
  .add(new THREE.Vector3(...LIGHTHOUSE_OBJ.pos))
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0)

function makeGlowTex() {
  // мягкое тёплое пятно для засветки экрана
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.45, 'rgba(255,225,150,0.45)'); gr.addColorStop(1, 'rgba(255,210,120,0)')
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function BeamMessenger({ onDone, onReset }) {
  const beamRef = useRef(), glareRef = useRef(), glowRef = useRef()
  const tex = useMemo(() => makeCircleTex('#fff2a8'), [])
  const glowTex = useMemo(() => makeGlowTex(), [])
  // конус из точек вдоль +X длиной 1 (растягивается до камеры), расширяется к концу
  const geo = useMemo(() => {
    const arr = new Float32Array(BEAM_PTS * 3)
    for (let i = 0; i < BEAM_PTS; i++) {
      const t = Math.pow(Math.random(), 0.8)
      const r = (0.01 + 0.12 * t) * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2
      arr[i*3] = t; arr[i*3+1] = Math.cos(a) * r; arr[i*3+2] = Math.sin(a) * r
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [])
  const glareGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3))
    return g
  }, [])
  const tmp = useMemo(() => ({ dir: new THREE.Vector3(), target: new THREE.Vector3(), qCam: new THREE.Quaternion(),
    qSide: new THREE.Quaternion(), qYaw: new THREE.Quaternion(), fwd: new THREE.Vector3() }), [])
  const st = useRef({ startedAt: -1, prevZ: Infinity, done: false })

  useFrame(({ clock, camera }) => {
    const beam = beamRef.current, glare = glareRef.current, glow = glowRef.current
    if (!beam || !glare || !glow) return
    const time = clock.getElapsedTime()
    const camZ = camera.position.z
    const s = st.current
    // срыв только при обычном пролёте, не при переносе камеры
    if (s.startedAt < 0 && s.prevZ > BEAM_TRIGGER_Z && camZ <= BEAM_TRIGGER_Z && !camTeleport.pending) s.startedAt = time
    if (s.startedAt >= 0 && camZ > BEAM_TRIGGER_Z + 1) {
      s.startedAt = -1
      if (s.done) { s.done = false; onReset?.() }
    }
    s.prevZ = camZ

    const el = s.startedAt < 0 ? -1 : time - s.startedAt - BEAM_WAIT
    const total = BEAM_SWEEP + BEAM_HOLD + BEAM_RELEASE
    if (el < 0 || el > total) {
      beam.visible = glare.visible = glow.visible = false
      lighthouseState.lock = 0
      return
    }
    const sweep = THREE.MathUtils.smoothstep(el, 0, BEAM_SWEEP)                    // доворот на камеру
    const rel = THREE.MathUtils.smoothstep(el, BEAM_SWEEP + BEAM_HOLD, total)       // уход дальше
    if (el >= BEAM_SWEEP + BEAM_CARD_AT && !s.done) { s.done = true; onDone?.() }
    const fade = clamp(el / 0.35, 0, 1) * (1 - rel)
    lighthouseState.lock = fade

    // цель — чуть ниже глаз, чтобы конус шёл прямо на зрителя; конус обрывается в 7 единицах от камеры
    tmp.target.set(camera.position.x, camera.position.y - 0.5, camZ)
    tmp.dir.subVectors(tmp.target, LANTERN)
    const dist = tmp.dir.length()
    tmp.dir.normalize()
    tmp.qCam.setFromUnitVectors(_X, tmp.dir)
    // приходит со стороны моря (поворот вокруг вертикали) и уходит в другую сторону
    const yaw = (1 - sweep) * 1.3 - rel * 1.3
    tmp.qYaw.setFromAxisAngle(_Y, yaw)
    tmp.qSide.copy(tmp.qYaw).multiply(tmp.qCam)
    beam.visible = true
    beam.position.copy(LANTERN)
    beam.quaternion.copy(tmp.qSide)
    beam.scale.setScalar(Math.max(dist - 7, 1))     // вблизи камеры точки стали бы огромными
    beam.material.opacity = 0.5 * fade

    // яркий фонарь
    glare.visible = true
    glare.position.copy(LANTERN)
    glare.material.opacity = fade
    glare.material.size = 2.2 + 0.9 * sweep * (1 - rel)

    // засветка, пока луч смотрит на нас (с лёгким мерцанием)
    const inBeam = sweep * (1 - rel)
    glow.visible = inBeam > 0.01
    // блик — со стороны фонаря: ярко у маяка, к краям экрана гаснет
    tmp.fwd.subVectors(LANTERN, camera.position).normalize()
    glow.position.copy(camera.position).addScaledVector(tmp.fwd, 2)
    glow.quaternion.copy(camera.quaternion)
    glow.material.opacity = 0.3 * inBeam * (0.92 + 0.08 * Math.sin(time * 9))
  })

  return (
    <>
      <points ref={beamRef} geometry={geo} visible={false}>
        <pointsMaterial map={tex} size={0.16} sizeAttenuation alphaTest={0.02} transparent opacity={0}
          depthWrite={false} fog={false} color="#fff2a8" blending={THREE.AdditiveBlending} />
      </points>
      <points ref={glareRef} geometry={glareGeo} visible={false}>
        <pointsMaterial map={tex} size={2.2} sizeAttenuation transparent opacity={0}
          depthWrite={false} fog={false} color="#fff6c8" blending={THREE.AdditiveBlending} />
      </points>
      <mesh ref={glowRef} visible={false} renderOrder={10}>
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial map={glowTex} transparent opacity={0} depthTest={false} depthWrite={false}
          fog={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </>
  )
}

function BeamMessengers({ onMessengerDone }) {
  // луч маяка один (Designs II); onMessengerDone(id, true/false) — открыть / снова закрыть карточку
  return BEAM_STATION
    ? <BeamMessenger onDone={() => onMessengerDone?.(BEAM_STATION.id, true)} onReset={() => onMessengerDone?.(BEAM_STATION.id, false)} />
    : null
}

// ─── Письмо из почтового ящика — вестник раздела Contact ────────────────────
// Камера пересекает LETTER_TRIGGER_Z (почти у берега) → письмо выскакивает из ящика, по дуге
// летит к центру кадра, кувыркаясь, зависает и тает → onDone: карточка Contact открывается сама.
// Вернулись назад за точку срыва — письмо снова в ящике.
const LETTER_STATION   = STATION_MARKS.find((s) => s.messenger === 'letter')
const LETTER_TRIGGER_Z = LETTER_STATION ? messengerTriggerZ(LETTER_STATION) : -662
const MAILBOX = BEACH_OBJECTS.find((o) => o.url.includes('mailbox'))
const LETTER_POP   = 0.6    // с — выскакивает из ящика
const LETTER_FLY   = 1.5    // с — летит к центру кадра
const LETTER_HOVER = 0.35   // с — зависает
const LETTER_FADE  = 0.35   // с — тает
const LETTER_PTS   = 700

function makeLetterGeometry() {
  // конверт в плоскости XY (ширина 1, высота 0.64): кремовое поле, кромка, клапан «галочкой»
  // и красная сургучная печать в центре
  const W = 0.5, H = 0.32
  const pos = new Float32Array(LETTER_PTS * 3), col = new Float32Array(LETTER_PTS * 3)
  const paper = new THREE.Color('#fff4dc'), edge = new THREE.Color('#e6cf9e'), seal = new THREE.Color('#e0473c')
  const c = new THREE.Color()
  for (let i = 0; i < LETTER_PTS; i++) {
    let x, y
    if (i < 160) {                       // кромка
      const t = Math.random() * 4, k = t % 1
      if (t < 1) { x = -W + 2 * W * k; y = H } else if (t < 2) { x = W; y = H - 2 * H * k }
      else if (t < 3) { x = W - 2 * W * k; y = -H } else { x = -W; y = -H + 2 * H * k }
      c.copy(edge)
    } else if (i < 260) {                // клапан: от верхних углов к центру
      const k = Math.random(), side = i % 2 ? 1 : -1
      x = side * W * (1 - k); y = H - (H + 0.02) * k
      c.copy(edge)
    } else if (i < 300) {                // печать
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.07
      x = Math.cos(a) * r; y = -0.02 + Math.sin(a) * r
      c.copy(seal)
    } else {                             // бумага
      x = (Math.random() * 2 - 1) * W; y = (Math.random() * 2 - 1) * H
      c.copy(paper)
    }
    pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = 0
    col[i*3] = c.r * 0.9; col[i*3+1] = c.g * 0.9; col[i*3+2] = c.b * 0.9   // без пересвета у камеры
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color',    new THREE.BufferAttribute(col, 3))
  return g
}

function LetterMessenger({ onDone, onReset }) {
  const { scene } = useGLTF(MAILBOX.url)
  const ref = useRef()
  const tex = useMemo(() => makeCircleTex('#ffffff'), [])
  const geo = useMemo(() => makeLetterGeometry(), [])
  // щель ящика — верх модели в мировых координатах
  const start = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    return new THREE.Vector3(MAILBOX.pos[0], MAILBOX.pos[1] + box.max.y * MAILBOX.scale, MAILBOX.pos[2])
  }, [scene])
  const tmp = useMemo(() => ({ top: new THREE.Vector3(), dest: new THREE.Vector3(), ctrl: new THREE.Vector3() }), [])
  const st = useRef({ startedAt: -1, prevZ: Infinity, done: false })

  useFrame(({ clock, camera }) => {
    const L = ref.current; if (!L) return
    const time = clock.getElapsedTime()
    const camZ = camera.position.z
    const s = st.current
    // срыв только при обычном пролёте, не при переносе камеры
    if (s.startedAt < 0 && s.prevZ > LETTER_TRIGGER_Z && camZ <= LETTER_TRIGGER_Z && !camTeleport.pending) s.startedAt = time
    if (s.startedAt >= 0 && camZ > LETTER_TRIGGER_Z + 1) {
      s.startedAt = -1
      if (s.done) { s.done = false; fireworks.start = -Infinity; onReset?.() }
    }
    s.prevZ = camZ

    const el = s.startedAt < 0 ? -1 : time - s.startedAt
    const total = LETTER_POP + LETTER_FLY + LETTER_HOVER + LETTER_FADE
    if (el < 0) { L.visible = false; return }                  // письмо ещё в ящике
    if (el > total) {
      L.visible = false
      if (!s.done) { s.done = true; fireworks.start = time; onDone?.() }   // карточка + салют
      return
    }
    L.visible = true
    // 1) выскакивает из щели вверх, покачиваясь
    tmp.top.copy(start); tmp.top.y += 1.6
    if (el < LETTER_POP) {
      const k = 1 - Math.pow(1 - el / LETTER_POP, 3)
      L.position.lerpVectors(start, tmp.top, k)
      L.rotation.set(0, Math.sin(el * 10) * 0.3, Math.sin(el * 7) * 0.25)
      L.scale.setScalar(1.1 * (0.4 + 0.6 * k))
      L.material.opacity = clamp(el / 0.15, 0, 1)
      return
    }
    // 2) по дуге к центру кадра, кувыркаясь; к концу выравнивается лицом к нам
    tmp.dest.set(camera.position.x, camera.position.y - 0.1, camZ - 4)
    const f = clamp((el - LETTER_POP) / LETTER_FLY, 0, 1)
    const e = 1 - Math.pow(1 - f, 3)
    tmp.ctrl.lerpVectors(tmp.top, tmp.dest, 0.5); tmp.ctrl.y += 2.5; tmp.ctrl.x += 2
    const u = 1 - e
    L.position.set(
      u*u*tmp.top.x + 2*u*e*tmp.ctrl.x + e*e*tmp.dest.x,
      u*u*tmp.top.y + 2*u*e*tmp.ctrl.y + e*e*tmp.dest.y,
      u*u*tmp.top.z + 2*u*e*tmp.ctrl.z + e*e*tmp.dest.z)
    const spin = 1 - e
    L.rotation.set(Math.sin(el * 5) * 0.6 * spin, el * 6 * spin, Math.sin(el * 4) * 0.4 * spin)
    L.scale.setScalar(1.1 + (0.9 - 1.1) * e)
    // 3) зависает и тает, чуть увеличиваясь
    const fade = clamp((el - LETTER_POP - LETTER_FLY - LETTER_HOVER) / LETTER_FADE, 0, 1)
    L.material.opacity = 1 - fade
    if (fade > 0) L.scale.multiplyScalar(1 + 0.25 * fade)
  })

  return (
    <points ref={ref} geometry={geo} visible={false}>
      <pointsMaterial map={tex} vertexColors size={0.06} sizeAttenuation alphaTest={0.05}
        transparent depthWrite={false} />
    </points>
  )
}

// ─── Салют над пляжем ────────────────────────────────────────────────────────
// Начинается вместе с карточкой Contact (письмо растаяло → fireworks.start). В небе над пляжем
// по очереди загораются точки-звёзды, разгораются и взрываются разноцветными искрами, которые
// разлетаются, опадают и гаснут.
const fireworks = { start: -Infinity }
const FW_SHELLS  = 9
const FW_SPARKS  = 160         // искр в одном взрыве
const FW_GAP     = 0.5         // с между звёздами
const FW_GLOW    = 0.45        // с — звезда разгорается перед взрывом
const FW_LIFE    = 2.2         // с — искры живут
const FW_COLORS  = ['#ff5d8f', '#ffd166', '#7ae3ff', '#b28dff', '#7dff9a', '#ff9f43', '#ffffff']

function Fireworks() {
  const sparksRef = useRef(), starsRef = useRef()
  const tex = useMemo(() => makeCircleTex('#ffffff'), [])
  // для каждого залпа: центр в небе за пляжем, цвет, задержка; для каждой искры — скорость
  const data = useMemo(() => {
    const shells = []
    for (let i = 0; i < FW_SHELLS; i++) {
      shells.push({
        // по бокам от карточки (она в центре экрана) и повыше, попеременно слева и справа
        center: new THREE.Vector3((i % 2 ? 1 : -1) * (15 + Math.random() * 18), 9 + Math.random() * 10, SAND_END_Z - 4 - Math.random() * 8),
        color: new THREE.Color(FW_COLORS[i % FW_COLORS.length]),
        color2: new THREE.Color(FW_COLORS[(i + 3) % FW_COLORS.length]),
        delay: i * FW_GAP + Math.random() * 0.2,
        size: 8 + Math.random() * 4,
      })
    }
    const vel = new Float32Array(FW_SHELLS * FW_SPARKS * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < FW_SHELLS * FW_SPARKS; i++) {
      v.randomDirection().multiplyScalar(0.75 + Math.random() * 0.25)   // почти ровная сфера
      vel[i*3] = v.x; vel[i*3+1] = v.y; vel[i*3+2] = v.z
    }
    const sparks = new THREE.BufferGeometry()
    sparks.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FW_SHELLS * FW_SPARKS * 3), 3))
    sparks.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(FW_SHELLS * FW_SPARKS * 3), 3))
    const stars = new THREE.BufferGeometry()
    stars.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FW_SHELLS * 3), 3))
    stars.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(FW_SHELLS * 3), 3))
    return { shells, vel, sparks, stars }
  }, [])

  useFrame(({ clock }) => {
    const sp = sparksRef.current, st = starsRef.current
    if (!sp || !st) return
    const el = clock.getElapsedTime() - fireworks.start
    const showEnd = (FW_SHELLS - 1) * FW_GAP + 0.2 + FW_GLOW + FW_LIFE
    sp.visible = st.visible = el >= 0 && el <= showEnd
    if (!sp.visible) return
    const P = data.sparks.attributes.position.array, C = data.sparks.attributes.color.array
    const SP = data.stars.attributes.position.array, SC = data.stars.attributes.color.array
    data.shells.forEach((sh, k) => {
      const t = el - sh.delay
      // звезда: загорается и разгорается до взрыва (цвет = яркость, смешивание аддитивное)
      const glow = t >= 0 && t < FW_GLOW ? THREE.MathUtils.smoothstep(t, 0, FW_GLOW) : 0
      SP[k*3] = sh.center.x; SP[k*3+1] = sh.center.y; SP[k*3+2] = sh.center.z
      SC[k*3] = 1.6 * glow; SC[k*3+1] = 1.5 * glow; SC[k*3+2] = 1.3 * glow
      // искры
      const tb = t - FW_GLOW
      for (let j = 0; j < FW_SPARKS; j++) {
        const i = k * FW_SPARKS + j
        if (tb < 0 || tb > FW_LIFE) { P[i*3+1] = -100; C[i*3] = C[i*3+1] = C[i*3+2] = 0; continue }
        const spread = sh.size * (1 - Math.exp(-3 * tb))          // быстро разлетаются и тормозят
        P[i*3]   = sh.center.x + data.vel[i*3]   * spread
        P[i*3+1] = sh.center.y + data.vel[i*3+1] * spread - 1.6 * tb * tb   // опадают
        P[i*3+2] = sh.center.z + data.vel[i*3+2] * spread
        const life = 1 - tb / FW_LIFE
        const b = 1.5 * life * life * (0.75 + 0.25 * Math.sin(tb * 30 + j))   // гаснут, мерцая
        const c = j % 3 ? sh.color : sh.color2
        C[i*3] = c.r * b; C[i*3+1] = c.g * b; C[i*3+2] = c.b * b
      }
    })
    data.sparks.attributes.position.needsUpdate = true
    data.sparks.attributes.color.needsUpdate = true
    data.stars.attributes.color.needsUpdate = true
    data.stars.attributes.position.needsUpdate = true
  })

  return (
    <>
      <points ref={sparksRef} geometry={data.sparks} visible={false} frustumCulled={false}>
        <pointsMaterial map={tex} vertexColors size={0.5} sizeAttenuation alphaTest={0.01} transparent
          depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
      </points>
      <points ref={starsRef} geometry={data.stars} visible={false} frustumCulled={false}>
        <pointsMaterial map={tex} vertexColors size={2.4} sizeAttenuation alphaTest={0.01} transparent
          depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
      </points>
    </>
  )
}

function LetterMessengers({ onMessengerDone }) {
  // письмо одно (Contact); onMessengerDone(id, true/false) — открыть / снова закрыть карточку
  return LETTER_STATION
    ? <LetterMessenger onDone={() => onMessengerDone?.(LETTER_STATION.id, true)} onReset={() => onMessengerDone?.(LETTER_STATION.id, false)} />
    : null
}

function LeafMessengers({ onMessengerDone }) {
  // листок один (Education); onMessengerDone(id, true/false) — открыть / снова закрыть его карточку
  return LEAF_STATION
    ? <LeafMessenger onDone={() => onMessengerDone?.(LEAF_STATION.id, true)} onReset={() => onMessengerDone?.(LEAF_STATION.id, false)} />
    : null
}

function BirdMessengers({ onMessengerDone }) {
  // птица одна (Projects); onMessengerDone(id, true/false) — открыть / снова закрыть её карточку
  return BIRD_STATION
    ? <BirdMessenger onDone={() => onMessengerDone?.(BIRD_STATION.id, true)} onReset={() => onMessengerDone?.(BIRD_STATION.id, false)} />
    : null
}

// ─── Атмосфера + туман ────────────────────────────────────────────────────────

function Atmosphere() {
  const { scene } = useThree()
  useEffect(() => {
    scene.fog = new THREE.FogExp2('#000000', 0.003)
    return () => { scene.fog = null }
  }, [scene])
  useFrame(({ camera, scene }) => {
    const fp = forestProgress(camera.position.z)
    const sp = seaProgress(camera.position.z)
    const bp = beachProgress(camera.position.z)
    const bg = new THREE.Color('#000000')
      .lerp(new THREE.Color('#050e05'), fp)
      .lerp(new THREE.Color('#020d18'), sp)
      .lerp(new THREE.Color('#0a0d1a'), bp)
    scene.background = bg
    if (scene.fog) {
      scene.fog.color.copy(bg)
      scene.fog.density = fp * 0.015 + sp * 0.008
    }
  })
  return null
}

function ForestLight() {
  const ref = useRef()
  useFrame(({ camera }) => {
    if (!ref.current) return
    ref.current.intensity = forestProgress(camera.position.z) * 0.7
    ref.current.position.set(camera.position.x, camera.position.y + 20, camera.position.z - 30)
  })
  return <pointLight ref={ref} color="#33ff66" intensity={0} distance={120} />
}

function SeaLight() {
  const ref = useRef()
  useFrame(({ camera }) => {
    if (!ref.current) return
    ref.current.intensity = seaProgress(camera.position.z) * 1.0
    ref.current.position.set(camera.position.x, camera.position.y + 15, camera.position.z - 20)
  })
  return <pointLight ref={ref} color="#1188cc" intensity={0} distance={150} />
}

// ─── Управление ───────────────────────────────────────────────────────────────

// flyTarget — автополёт камеры к заданной Z (кнопка «Contact now»);
// любое ручное управление (клавиши, колесо) его прерывает
const AUTO_MAX_SPEED = 60

function FlightControls({ onZChange, flyTarget, onFlyEnd, onFreezeChange }) {
  const { camera, gl } = useThree()
  const keys     = useRef({})
  const wheelVel = useRef(0)
  const touches  = useRef(new Map())         // касание → направление: +1 вперёд (справа), -1 назад (слева)
  const freezeUntil = useRef(0)              // до какого времени камера стоит перед дельфинами
  const frozen      = useRef(false)          // сообщаем наружу только смену состояния
  const flyZ        = useRef(null)           // пролёт к этой Z с обычной скоростью (событие camera-fly)
  const gotoZ       = useRef(null)           // куда перенести камеру в следующем кадре (событие camera-goto)


  useEffect(() => {
    const down  = (e) => { keys.current[e.code] = true }
    const up    = (e) => { keys.current[e.code] = false }
    // колесо над тем, что можно прокрутить в эту сторону (модалка Fast check, длинная карточка),
    // прокручивает его; в остальных местах — полёт камеры
    const canScroll = (el, dy) => {
      for (; el && el !== document.body; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
          if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true
        }
      }
      return false
    }
    const wheel = (e) => {
      if (e.target instanceof Element && (canScroll(e.target, e.deltaY) || e.target.closest('[role="dialog"]'))) return
      e.preventDefault(); wheelVel.current += e.deltaY * 0.04
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    window.addEventListener('wheel',   wheel, { passive: false })

    // телефон: палец держат справа — летим вперёд, слева — назад. Слушаем всё окно (поверх
    // сцены лежат индикатор разделов, карточки и т. п.), пропуская только то, что нажимается
    gl.domElement.style.touchAction = 'none' // без прокрутки и масштабирования страницы
    const INTERACTIVE = 'button, a, input, textarea, select, label, [role="dialog"], [role="radiogroup"], [data-tap]'
    const tStart = (e) => {
      if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return
      e.preventDefault()                     // без выделения текста и меню долгого нажатия
      for (const t of e.changedTouches) touches.current.set(t.identifier, t.clientX > window.innerWidth / 2 ? 1 : -1)
    }
    const tEnd = (e) => { for (const t of e.changedTouches) touches.current.delete(t.identifier) }
    window.addEventListener('touchstart',  tStart, { passive: false })
    window.addEventListener('touchend',    tEnd)
    window.addEventListener('touchcancel', tEnd)
    // перенос камеры по событию (навигация по разделам для тестов, редактор траекторий)
    const goto = (e) => { gotoZ.current = e.detail.z; flyZ.current = e.detail.flyTo ?? null }
    window.addEventListener('camera-goto', goto)
    return () => {
      window.removeEventListener('camera-goto', goto)
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup',   up)
      window.removeEventListener('wheel',   wheel)
      window.removeEventListener('touchstart',  tStart)
      window.removeEventListener('touchend',    tEnd)
      window.removeEventListener('touchcancel', tEnd)
    }
  }, [gl])

  useFrame(({ clock }, delta) => {
    const now = clock.getElapsedTime()
    camTeleport.pending = false
    if (gotoZ.current !== null) {
      camTeleport.pending = true
      // перенос: отменяет автополёт и паузу у дельфинов
      camera.position.z = Math.max(gotoZ.current, CAMERA_END_Z)
      gotoZ.current = null
      wheelVel.current = 0
      freezeUntil.current = 0
      if (flyTarget) onFlyEnd?.()
      if (frozen.current) { frozen.current = false; onFreezeChange?.(false) }
      onZChange(camera.position.z)
      return
    }
    if (flyTarget) freezeUntil.current = 0   // «Contact now» отменяет паузу
    const isFrozen = now < freezeUntil.current
    if (isFrozen !== frozen.current) {
      frozen.current = isFrozen; onFreezeChange?.(isFrozen)
      if (!isFrozen) seaChain.dolphinsDoneAt = performance.now() / 1000   // прыжок закончился — плывут парусники
    }
    if (camera.position.z > DOLPHIN_STOP_Z + 1 && (seaChain.dolphinsDoneAt !== null || SEA_CHAIN.some((id) => routeStart[id] !== undefined && !routeHold[id]))) resetSeaChain()
    // пауза перед дельфинами: камера стоит, ввод игнорируется
    if (isFrozen) {
      camera.position.z = DOLPHIN_STOP_Z
      wheelVel.current = 0
      onZChange(camera.position.z)
      return
    }
    const prevZ = camera.position.z
    const k = keys.current; const speed = 12.5
    let touchDir = 0
    for (const d of touches.current.values()) touchDir += d
    touchDir = clamp(touchDir, -1, 1)
    const manual = k['KeyW'] || k['ArrowUp'] || k['KeyS'] || k['ArrowDown'] || touchDir !== 0 || Math.abs(wheelVel.current) > 0.5
    if (flyTarget && manual) onFlyEnd?.()
    if (flyTarget && !manual) {
      // плавный разгон и торможение у цели
      const dz = flyTarget.z - camera.position.z
      const step = Math.min(Math.abs(dz) * 1.2 + 4, AUTO_MAX_SPEED) * Math.min(delta, 0.1)
      camera.position.z += Math.sign(dz) * Math.min(Math.abs(dz), step)
      if (Math.abs(flyTarget.z - camera.position.z) < 0.05) onFlyEnd?.()
    }
    if (k['KeyW'] || k['ArrowUp'])   camera.position.z -= speed * delta
    if (k['KeyS'] || k['ArrowDown']) camera.position.z += speed * delta
    camera.position.z -= touchDir * speed * delta
    if (flyZ.current !== null) {
      if (manual) flyZ.current = null
      else {
        const dz = flyZ.current - camera.position.z
        camera.position.z += Math.sign(dz) * Math.min(Math.abs(dz), speed * delta)
        if (Math.abs(dz) < 0.01) flyZ.current = null
      }
    }
    camera.position.z -= wheelVel.current * delta * 4
    wheelVel.current *= 0.88
    // дальше берега не летим
    if (camera.position.z < CAMERA_END_Z) { camera.position.z = CAMERA_END_Z; wheelVel.current = 0 }
    // пересекли точку остановки вперёд (не в автополёте) — замираем и запускаем прыжки
    if (!flyTarget && prevZ > DOLPHIN_STOP_Z && camera.position.z <= DOLPHIN_STOP_Z) {
      camera.position.z = DOLPHIN_STOP_Z
      wheelVel.current = 0
      freezeUntil.current = now + DOLPHIN_STOP_TIME
      dolphinShow.start = now
      frozen.current = true; onFreezeChange?.(true)
    }
    onZChange(camera.position.z)
  })

  return null
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

export default function SpaceScene({ onZChange, flyTarget, onFlyEnd, onFreezeChange, onMessengerDone }) {
  return (
    <>
      <ambientLight intensity={0.12} />
      <Atmosphere />
      <ForestLight />
      <SeaLight />
      <FlightControls onZChange={onZChange} flyTarget={flyTarget} onFlyEnd={onFlyEnd} onFreezeChange={onFreezeChange} />

      {/* Космос */}
      <WarpStars count={5000} />
      <TwinklePoints count={700} colorSpace="#ffffff" colorForest="#aaffaa" speed={1.2} phase={0}   />
      <TwinklePoints count={400} colorSpace="#cce8ff" colorForest="#66ff88" speed={0.8} phase={1.8} />

      {/* Линия пути */}
      <PathLine />

      {/* Звёзды, приносящие разделы меню */}
      <StationStars />

      {/* Лес: земля и трава — частицы, деревья, облака и птичка — low-poly модели */}
      <ParticleGround />
      <ParticleGrass />
      <Suspense fallback={null}>
        <ForestObjects />
        <BirdMessengers onMessengerDone={onMessengerDone} />
      </Suspense>
      <LeafMessengers onMessengerDone={onMessengerDone} />
      <BeamMessengers onMessengerDone={onMessengerDone} />

      {/* Море */}
      <SeaParticles />
      <SeaGlints />
      <Suspense fallback={null}>
        <SeaObjects />
      </Suspense>

      {/* Пляж — раздел Contact */}
      <Beach />
      <Suspense fallback={null}>
        <BeachObjects />
        <LetterMessengers onMessengerDone={onMessengerDone} />
        <Fireworks />
      </Suspense>
    </>
  )
}
