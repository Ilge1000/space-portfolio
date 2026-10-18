// Общие данные станций: их читает и 3D-сцена (звёзды-вестники), и Overlay (панели)
export const STATION_RANGE = 30 // панель видна, пока |cameraZ - triggerZ| < STATION_RANGE

// Зоны по Z (камера летит в минус): космос 0…-200, лес -200…-460, море -460…-650, пляж -650…-672
// (камера останавливается на CAMERA_END_Z, впереди — узкая полоска берега с объектами).
// Между станциями ≥ ~100 единиц: 60 — панель открыта, ~40 — полёт звезды следующей станции.
// flight: 'far' — прилетает из глубины сцены по спирали; иначе — из-за правого края экрана
// star: false — у станции нет звезды; afterDolphins — карточка ждёт конца прыжка дельфинов;
// messenger: 'bird' — вместо звезды прилетает птица с дерева; 'leaf' — листок пролетает мимо камеры;
// from: 'topLeft' — звезда режима far начинает из верхнего левого угла, а не из центра;
// messenger: 'beam' — луч маяка наводится на камеру; 'letter' — письмо вылетает из почтового ящика; lead — за сколько единиц до станции срывается вестник
export const STATION_MARKS = [
  // Космос
  { id: 'about',     triggerZ: -80,  color: '#ffe08a', flight: 'far' },
  { id: 'skills',    triggerZ: -180, color: '#b4ffc8', flight: 'far', from: 'topLeft' },
  // Лес
  { id: 'education', triggerZ: -290, color: '#c9b6ff', messenger: 'leaf', afterMessenger: true },
  { id: 'projects',  triggerZ: -400, color: '#aaddff', messenger: 'bird', afterMessenger: true },
  // Море
  // карточка открывается на остановке камеры перед дельфинами (-472), сразу после их прыжка;
  // -501.5: зона карточки (±30) начинается ровно у точки остановки, чтобы она не мелькнула на подлёте
  { id: 'designs',   triggerZ: -501.5, color: '#7ff0e0', star: false, afterDolphins: true },
  { id: 'designs2',  triggerZ: -615, color: '#9fc7ff', messenger: 'beam', lead: 30, afterMessenger: true },
  // Пляж
  // -672 — точка, где камера останавливается у берега; письмо вылетает за 10 единиц до неё
  { id: 'contact',   triggerZ: -672, color: '#ffb8e6', messenger: 'letter', lead: 10, afterMessenger: true },
]

export const stationMark = (id) => STATION_MARKS.find((s) => s.id === id)

// дальше камера не летит: впереди берег (последний раздел — Contact)
export const CAMERA_END_Z = -672

// вестник (листок, птица) срывается, когда камера пересекает triggerZ + MESSENGER_LEAD; дальше его
// полёт идёт по времени, и карточка (afterMessenger) открывается сама, когда вестник растает
export const MESSENGER_LEAD = 50
export const messengerTriggerZ = (station) => station.triggerZ + (station.lead ?? MESSENGER_LEAD)

// точка, где камера замирает перед дельфинами (уже над морем); карточка с afterDolphins
// открывается только после их прыжка
export const DOLPHIN_STOP_Z = -472

// куда переносит камеру клик по разделу в индикаторе пути (временная навигация для тестов,
// см. NAV_LINKS_ENABLED): чуть раньше начала сцены раздела — дальше лететь самим (W / колесо)
export function stationJumpZ(station) {
  if (station.messenger) return messengerTriggerZ(station) + 3      // листок / птица ещё на дереве
  if (station.afterDolphins) return DOLPHIN_STOP_Z + 8                // перед остановкой у дельфинов
  return station.triggerZ + STATION_RANGE + 25                       // звезда уже летит навстречу
}

// перелёт звезды привязан к пути камеры: начинается на starStartZ и кончается на triggerZ + STATION_RANGE
export const STAR_FLIGHT = { far: 55, near: 40 }
export const starArriveZ = (station) => station.triggerZ + STATION_RANGE
export const starStartZ = (station) =>
  Math.min(starArriveZ(station) + (station.flight === 'far' ? STAR_FLIGHT.far : STAR_FLIGHT.near), 5)
