// Траектории вестников и моделей на воде (сохранены в trajectories.json).
// Точки вестников — в координатах экрана от -1 до 1 (x вправо, y вверх): вестник летит так, что на
// экране повторяет линию, а по глубине приближается к камере. Если траектории нет — летит по
// встроенной дуге. Модели на воде (WATER_MODELS): путь в мировых координатах [x, z] на поверхности
// воды — модель ждёт в начале, проплывает путь один раз и тает в конце.
import saved from './trajectories.json'

// модели, которые плавают по своему пути (их же расставляет SEA_OBJECTS в SpaceScene)
export const WATER_MODELS = {
  // duration — за сколько секунд модель проходит путь, какой бы длины он ни был
  // Проход перед камерой: пока камера пролетает свой участок camZ [начало, конец], группа пересекает
  // экран по линии z на воде — x от x[0] до x[1]; стоит камера — доплывает сама за duration
  sailboat: { label: 'Sailboat', pos: [-13, -3.75, -505], camZ: [-472, -506], z: -512, x: [-50, 22], duration: 8 },
  turtle:   { label: 'Turtle',   pos: [ -6, -3.6,  -550], camZ: [-508, -542], z: -548, x: [ 48, -22], duration: 8 },
  ship:     { label: 'Ship',     pos: [ 15, -3.6,  -580], camZ: [-544, -578], z: -584, x: [-52, 24], duration: 9 },
}

// когда модель на воде начала путь: id → performance.now() в секундах
export const routeStart = {}
// id → true: модель стоит в начале пути (в релизе пусто, оставлено для SpaceScene)
export const routeHold = {}

// Морская цепочка: после прыжка дельфинов — парусники, когда растаял последний из них — черепахи,
// потом корабль. dolphinsDoneAt — когда закончилась остановка у дельфинов (performance.now() / 1000)
export const SEA_CHAIN = ['sailboat', 'turtle', 'ship']
export const seaChain = { dolphinsDoneAt: null }
// id → true: путь идёт только по времени, без камеры (в релизе пусто, нужно для SpaceScene)
export const routeTimeOnly = {}
export const resetSeaChain = () => {
  seaChain.dolphinsDoneAt = null
  for (const id of SEA_CHAIN) { delete routeStart[id]; delete routeTimeOnly[id] }
}

export const getPath = (id) => saved[id] || null

// точка на пути при t ∈ [0, 1] — сглаженно (Catmull-Rom), out = { x, y }
export function samplePath(pts, t, out) {
  const n = pts.length
  const f = Math.min(Math.max(t, 0), 1) * (n - 1)
  const i = Math.min(Math.floor(f), n - 2)
  const u = f - i
  const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n - 1)]
  const cr = (a, b, c, d) =>
    0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u)
  out.x = cr(p0[0], p1[0], p2[0], p3[0])
  out.y = cr(p0[1], p1[1], p2[1], p3[1])
  return out
}
