import { useState, useEffect } from 'react'
import styles from './Overlay.module.css'
import { STATION_RANGE, stationMark, DOLPHIN_STOP_Z, messengerTriggerZ, stationJumpZ } from '../stations'
import { CAT_MODE_ENABLED, NAV_LINKS_ENABLED } from '../features'

// файлы из public/ — от адреса сайта (на GitHub Pages он не корень домена, а /space-portfolio/)
const ASSET = import.meta.env.BASE_URL

// переносит камеру (слушает FlightControls в SpaceScene)
const jumpTo = (z) => window.dispatchEvent(new CustomEvent('camera-goto', { detail: { z } }))

// Письмо мне: кнопка открывает почтовую программу посетителя с готовым письмом
// (адрес, тема и текст уже заполнены — остаётся нажать «Отправить» у себя в почте)
const MY_EMAIL = 'linkmaryone@gmail.com'

function ContactMail() {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const send = () => {
    if (!message.trim()) { setError('Write a message first'); return }
    const subject = name.trim() ? `Hello from ${name.trim()}` : 'Hello from your portfolio'
    const body = name.trim() ? `${message.trim()}\n\n— ${name.trim()}` : message.trim()
    window.location.href = `mailto:${MY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }
  return (
    <>
      <label>Your name
        <input type="text" placeholder="Alex" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>Message
        <textarea rows={3} placeholder="What's on your mind?" value={message}
          onChange={(e) => { setMessage(e.target.value); setError('') }} />
      </label>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <button type="button" onClick={send}>Send message →</button>
    </>
  )
}

// Сетка работ для разделов Designs: строка — заглушка «coming soon»,
// объект { title, img, zoom?, origin? } — работа с превью (zoom/origin — насколько и куда приблизить
// превью в плитке); клик открывает картинку целиком в новой вкладке
function DesignGrid({ items }) {
  return (
    <div className={styles.designGrid}>
      {items.map((d) => typeof d === 'string' ? (
        <div key={d} className={styles.designTile}>
          <span>{d}</span>
          <small>coming soon</small>
        </div>
      ) : (
        <a key={d.title} className={`${styles.designTile} ${styles.designWork}`} href={d.img} target="_blank" rel="noreferrer"
          style={{ '--zoom': d.zoom ?? 1.7, '--origin': d.origin ?? '4% 4%' }}>
          <img src={d.img} alt={d.title} loading="lazy" />
          <span className={styles.designCaption}>{d.title}</span>
        </a>
      ))}
    </div>
  )
}

// Станции вдоль пути — строго по порядку полёта (чем меньше Z, тем дальше вглубь)
const STATIONS = [
  {
    id: 'about',
    triggerZ: stationMark('about').triggerZ,
    color: stationMark('about').color,
    title: 'About Me',
    content: (
      <div className={styles.stationForm}>
        <p className={styles.helloLine}>Hello, I'm Maria!</p>
        <p className={styles.stationIntro}>
          10+ years of making things work for people — as a CEO, client relations leader,
          and teacher. Now I'm switching to tech: studying Computer Science and building
          the kind of products I used to support.
        </p>
        <div className={styles.timeline}>
          {[
            { year: 'Now', role: 'Computer Science student', place: 'University of the People · moving into development', next: true },
            { year: '2026', role: 'Client relations leader', place: 'IDEA LLC · team of 4' },
            { year: '2021–25', role: 'CEO', place: 'Computer Doctor LLC' },
            { year: '2016–20', role: 'English teacher for children', place: 'Freelance' },
          ].map((t) => (
            <div key={t.year} className={`${styles.timelineRow} ${t.next ? styles.timelineNext : ''}`}>
              <span className={styles.timelineYear}>{t.year}</span>
              <span><span className={styles.projectName}>{t.role}</span><br /><span className={styles.projectDesc}>{t.place}</span></span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'skills',
    triggerZ: stationMark('skills').triggerZ,
    color: stationMark('skills').color,
    title: 'Skills',
    content: (
      <div className={styles.eduWrap}>
        {[
          { group: 'Design', items: ['Figma', 'Adobe Illustrator', 'Adobe Photoshop', 'Procreate', 'Blender', 'Claude Design'] },
          { group: 'Development', items: ['JavaScript', 'Ruby on Rails', 'React / Vite', 'Three.js / WebGL', 'Electron', 'Telegram Bot API'] },
          { group: 'People and business', items: ['Friendly, professional communication', 'Team management',
            'Customer support and sales', 'Contracts and billing', 'Negotiations with suppliers (China, Europe)',
            'Document control', 'MS Office — any report'] },
        ].map((g) => (
          <div key={g.group}>
            <h3 className={styles.panelSub}>{g.group}</h3>
            <div className={styles.skillGrid}>
              {g.items.map((s) => <span key={s} className={styles.skillTag}>{s}</span>)}
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'education',
    triggerZ: stationMark('education').triggerZ,
    color: stationMark('education').color,
    title: 'Education & Languages',
    content: (
      <div className={styles.eduWrap}>
        <div className={styles.projectList}>
          {[
            { name: 'Bachelor of Computer Science', desc: 'University of the People · studying now' },
            { name: 'Chinese language program', desc: 'Southwest Jiaotong University 西南交通大学 · 1 year' },
            { name: 'Clinical psychology', desc: 'Russian National State Medical University · 4 years' },
          ].map((e) => (
            <div key={e.name} className={styles.projectCard}>
              <span className={styles.projectName}>{e.name}</span>
              <span className={styles.projectDesc}>{e.desc}</span>
            </div>
          ))}
        </div>
        <h3 className={styles.panelSub}>Languages</h3>
        <div className={styles.skillGrid}>
          {['Russian · native', 'English · C1 fluent', 'Chinese · HSK 4–5 fluent', 'French · elementary', 'Thai · basic'].map((l) => (
            <span key={l} className={styles.skillTag}>{l}</span>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'projects',
    triggerZ: stationMark('projects').triggerZ,
    color: stationMark('projects').color,
    title: 'Projects',
    content: (
      <div className={styles.projectList}>
        {[
          { name: 'MyThai GO', desc: 'Social platform for travelling in Thailand — design' },
          { name: 'Space Portfolio', desc: 'This site — immersive 3D portfolio in Three.js' },
          { name: 'SakotThaiIME · สะกด', desc: 'Type Thai by sound in Latin letters — a Windows keyboard with a 95k-word dictionary · Electron + React',
            url: 'https://github.com/Ilge1000/SakotThaiIME' },
          { name: 'Smart Notebook', desc: 'Desktop app — planner, notes with PDF / Excel / Word import, and a scientific calculator in one window, with switchable themes' },
        ].map((p) => p.url ? (
          <a key={p.name} className={`${styles.projectCard} ${styles.projectLink}`} href={p.url} target="_blank" rel="noreferrer">
            <span className={styles.projectName}>{p.name} <span aria-hidden="true">↗</span></span>
            <span className={styles.projectDesc}>{p.desc}</span>
          </a>
        ) : (
          <div key={p.name} className={styles.projectCard}>
            <span className={styles.projectName}>{p.name}</span>
            <span className={styles.projectDesc}>{p.desc}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    // TODO: заменить плитки-заглушки на реальные работы (картинки)
    id: 'designs',
    triggerZ: stationMark('designs').triggerZ,
    color: stationMark('designs').color,
    title: 'Designs',
    content: <DesignGrid items={[{ title: 'UI kit · dark gold', img: ASSET + 'designs/ui-kit-dark-gold.png' },
      { title: 'MyThai GO · listing page', img: ASSET + 'designs/mythaigo-listing-en.png', zoom: 1.15, origin: '50% 35%' },
      { title: 'Computer Doctor · business cards', img: ASSET + 'designs/computer-doctor-flyer.jpg', zoom: 1, origin: '50% 0%' },
      { title: 'Nurulla Real Estate · business cards', img: ASSET + 'designs/nurulla-business-cards.jpg', zoom: 1, origin: '50% 0%' }]} />,
  },
  {
    id: 'designs2',
    triggerZ: stationMark('designs2').triggerZ,
    color: stationMark('designs2').color,
    title: 'Designs II',
    content: <DesignGrid items={[
      { title: 'Caviar menu · table card', img: ASSET + 'designs/caviar-menu.jpg', zoom: 1.4, origin: '50% 62%' },
      { title: 'SakotThaiIME · Thai keyboard', img: ASSET + 'designs/sakot-thai-ime.png', zoom: 1, origin: '50% 50%' },
      { title: 'Smart Notebook · desktop app', img: ASSET + 'designs/smart-notebook.webp', zoom: 1, origin: '50% 0%' },
      { title: 'Space Portfolio · this site', img: ASSET + 'designs/space-portfolio.webp', zoom: 1.6, origin: '50% 48%' }]} />,
  },
  {
    id: 'contact',
    triggerZ: stationMark('contact').triggerZ,
    color: stationMark('contact').color,
    title: 'Contact',
    content: (
      <form className={styles.stationForm}>
        <div className={styles.contactLinks}>
          <a href="mailto:linkmaryone@gmail.com">linkmaryone@gmail.com</a>
          <a href="https://t.me/Ilk2165" target="_blank" rel="noreferrer">Telegram · @Ilk2165</a>
          <a href="https://line.me/ti/p/~linkmaryone" target="_blank" rel="noreferrer">LINE · linkmaryone</a>
        </div>
        <ContactMail />
        {/* пройти путь заново: камера возвращается в начало (z = 5, как после «Enter Space») */}
        <button type="button" className={styles.againBtn} onClick={() => jumpTo(5)}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
          Experience again
        </button>
      </form>
    ),
  },
]

const THRESHOLD = STATION_RANGE // насколько близко к станции чтобы показать панель

// зона пути для каждого раздела — подпись в шапке новой плашки
const ZONES = { about: 'Space', skills: 'Space', education: 'Forest', projects: 'Forest', designs: 'Sea', designs2: 'Sea', contact: 'Beach' }
// Панель раздела раскрывается из вспышки вестника: шапка с номером, зоной и прогрессом пути,
// большая полупрозрачная цифра на фоне, внизу — какой раздел следующий (в последнем — прощальная строка)
function StationPanel({ station }) {
  const idx = STATIONS.findIndex((s) => s.id === station.id)
  const num = String(idx + 1).padStart(2, '0')
  const next = STATIONS[idx + 1]
  return (
    <>
      <div className={styles.starFlash} style={{ '--star': station.color }} />
      <div className={`${styles.stationPanel} ${styles.panelV2}`} style={{ '--star': station.color }}>
        <div className={styles.v2Mark} aria-hidden="true">{num}</div>
        <div className={styles.v2Head}>
          <span className={styles.v2Zone}>{num} · {ZONES[station.id]}</span>
          <span className={styles.v2Dots} aria-label={`Section ${idx + 1} of ${STATIONS.length}`}>
            {STATIONS.map((s, i) => (
              <i key={s.id} className={i === idx ? styles.v2DotNow : i < idx ? styles.v2DotOn : undefined} />
            ))}
          </span>
        </div>
        <div className={styles.v2Body}>
          <h2 className={styles.v2Title}>{station.title}</h2>
          {station.content}
        </div>
        <div className={styles.v2Foot}>
          {next ? <>next: <span>{next.title} →</span></> : <>the end · <span>thanks for flying</span></>}
        </div>
      </div>
    </>
  )
}

// сенсорный экран (телефон/планшет) — другая подсказка по управлению
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

// Языки: пока только переключатель, перевод текстов — позже
const LANGS = ['EN', 'RU', 'CN']
const LANG_KEY = 'portfolio-lang'

function readLang() {
  try { return LANGS.includes(localStorage.getItem(LANG_KEY)) ? localStorage.getItem(LANG_KEY) : 'EN' } catch { return 'EN' }
}

function LangSwitch() {
  const [lang, setLang] = useState(readLang)
  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang) } catch { /* хранилище недоступно — не страшно */ }
    document.documentElement.lang = { EN: 'en', RU: 'ru', CN: 'zh' }[lang]
  }, [lang])
  return (
    <div className={styles.langSwitch} role="radiogroup" aria-label="Language">
      {LANGS.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={lang === l}
          className={`${styles.langBtn} ${lang === l ? styles.langBtnActive : ''}`}
          onClick={() => setLang(l)}>
          {l}
        </button>
      ))}
    </div>
  )
}

// Кнопки быстрого доступа по центру сверху
function TopBar({ onFastCheck, onEnterCat, onContactNow }) {
  return (
    <nav className={styles.topBar}>
      <LangSwitch />
      <button type="button" className={styles.topBtn} onClick={onFastCheck}>Fast check</button>
      {/* Cat mode не входит в первый релиз — см. features.js */}
      {CAT_MODE_ENABLED && (
        <button type="button" className={`${styles.topBtn} ${styles.topBtnCat}`} onClick={onEnterCat}>Cat mode</button>
      )}
      <button type="button" className={`${styles.topBtn} ${styles.topBtnAccent}`} onClick={onContactNow}>Contact now</button>
    </nav>
  )
}

// Fast check — все разделы сразу, без полёта
function FastCheck({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={styles.fastBackdrop} onClick={onClose}>
      <div className={styles.fastPanel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Fast check">
        <div className={styles.fastHead}>
          <h2 className={styles.stationTitle}>Fast check</h2>
          <button type="button" className={styles.fastClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        {STATIONS.map((s) => (
          <section key={s.id} className={styles.fastSection} style={{ '--star': s.color }}>
            <h3 className={styles.fastTitle}>{s.title}</h3>
            {s.content}
          </section>
        ))}
      </div>
    </div>
  )
}

export default function Overlay({ entered, onEnter, onEnterCat, onContactNow, cameraZ, dolphinHold, dolphinDone, messengerDone = {} }) {
  const [showHint, setShowHint] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [fastCheck, setFastCheck] = useState(false)

  const topBar = (
    <>
      <TopBar onFastCheck={() => setFastCheck(true)} onEnterCat={onEnterCat} onContactNow={onContactNow} />
      {fastCheck && <FastCheck onClose={() => setFastCheck(false)} />}
    </>
  )

  // Показываем подсказку через секунду после входа
  useEffect(() => {
    if (!entered) return
    const t = setTimeout(() => setShowHint(true), 800)
    return () => clearTimeout(t)
  }, [entered])

  // Автоскрытие подсказки
  useEffect(() => {
    if (!showHint) return
    const t = setTimeout(() => setShowHint(false), 5000)
    return () => clearTimeout(t)
  }, [showHint])

  // Текущая активная станция. Карточка Designs (afterDolphins) открывается сама сразу после
  // прыжка дельфинов, пока камера стоит; если камера пролетела точку остановки без прыжка
  // (например, «Contact now») — по обычному правилу
  const dolphinsAllow = !dolphinHold && (dolphinDone || cameraZ < DOLPHIN_STOP_Z - 0.01)
  // Карточки Education и Projects (afterMessenger) открываются сами, когда вестник (листок,
  // птица) долетел и растаял, —
  // от точки срыва листка до конца своей зоны, даже если камера стоит
  const isActive = (s) => {
    const m = stationMark(s.id)
    if (m.afterMessenger) return !!messengerDone[s.id] && cameraZ <= messengerTriggerZ(m) && cameraZ > s.triggerZ - THRESHOLD
    return Math.abs(cameraZ - s.triggerZ) < THRESHOLD && (!m.afterDolphins || dolphinsAllow)
  }
  const activeStation = STATIONS.find(isActive)

  if (!entered) {
    return (
      <>
      {topBar}
      <div className={styles.landing}>
        <div className={styles.landingInner}>
          <p className={styles.subtitle}>Welcome to my</p>
          <h1 className={styles.title}>Portfolio</h1>
          <p className={styles.hint}>
            <span className={styles.rolePart}>Creative Frontend Developer</span>
            <span className={styles.roleSep}> · </span>
            <span className={styles.rolePart}>Dreamer · Concept Creator</span>
          </p>
          <button className={styles.enterBtn} onClick={onEnter}>
            <span>Enter Space</span>
            <span className={styles.arrow}>→</span>
          </button>
        </div>
      </div>
      </>
    )
  }

  return (
    <>
      {topBar}

      {/* Прицел */}
      <div className={styles.crosshair}>
        <div className={styles.crosshairH} />
        <div className={styles.crosshairV} />
      </div>

      {/* Подсказка по управлению */}
      {showHint && !hintDismissed && (
        <div className={styles.hintBox} data-tap onClick={() => setHintDismissed(true)}>
          {isTouch ? (
            <>
              {/* телефон: держать палец справа — вперёд, слева — назад */}
              <div className={styles.hintKey}>◀ hold</div>
              <span>back</span>
              <div className={styles.hintSep} />
              <div className={styles.hintKey}>hold ▶</div>
              <span>forward</span>
              <span className={styles.hintClose}>tap to dismiss</span>
            </>
          ) : (
            <>
              <div className={styles.hintKey}>W</div>
              <span>fly forward</span>
              <div className={styles.hintSep} />
              <div className={styles.hintKey}>S</div>
              <span>fly back</span>
              <span className={styles.hintClose}>click to dismiss</span>
            </>
          )}
        </div>
      )}

      {/* Индикатор пути */}
      <div className={styles.pathIndicator}>
        {STATIONS.map((s) => {
          const dist = cameraZ - s.triggerZ
          const active = Math.abs(dist) < THRESHOLD
          const passed = cameraZ < s.triggerZ
          return (
            <div key={s.id} className={`${styles.pathDot} ${active ? styles.pathDotActive : ''} ${passed ? styles.pathDotPassed : ''} ${NAV_LINKS_ENABLED ? styles.pathDotLink : ''}`}
              {...(NAV_LINKS_ENABLED && { role: 'button', tabIndex: 0, 'data-tap': true, title: 'Перейти к разделу',
                onClick: () => jumpTo(stationJumpZ(stationMark(s.id))),
                onKeyDown: (e) => { if (e.key === 'Enter') jumpTo(stationJumpZ(stationMark(s.id))) } })}>
              <span className={styles.pathLabel}>{s.title}</span>
            </div>
          )
        })}
      </div>

      {/* Панель станции */}
      {activeStation && <StationPanel key={activeStation.id} station={activeStation} />}
    </>
  )
}
