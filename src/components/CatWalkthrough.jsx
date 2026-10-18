import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// файлы из public/ — от адреса сайта (на GitHub Pages он не корень домена, а /space-portfolio/)
const ASSET = import.meta.env.BASE_URL

const STATIONS = [
  { z: 6,     title: "Обо мне",              tag: "старт",   accent: "#c89a3c",
    desc: "Разработчик веб-приложений для малого бизнеса. Делаю системы, которые убирают рутину — и делаю их красивыми. За мной! →" },
  { z: 1,     title: "Система онлайн-записи", tag: "кейс 01", accent: "#5f8a80",
    desc: "Клиент сам выбирает услугу и свободный слот, бронь падает в расписание владельца. Конец записи в переписке." },
  { z: -4,    title: "Мини-CRM",              tag: "кейс 02", accent: "#7a8347",
    desc: "База клиентов, история обращений, статусы заказов. Замена хаотичным Excel-таблицам." },
  { z: -9,    title: "Учёт и аналитика",      tag: "кейс 03", accent: "#bf923f",
    desc: "Складской учёт и дашборд с цифрами бизнеса — таблицы, графики, понятная картина." },
  { z: -13.2, title: "Напишите мне",          tag: "контакт", accent: "#c0623c",
    desc: "Понравилось? Соберу такое же под вашу задачу. Telegram · почта · форма." },
];

// z-позиции трёх пар столов (соответствуют кейсам)
const DESK_ZS = [1, -4, -9];

export default function Walkthrough() {
  const mountRef    = useRef(null);
  const idxRef      = useRef(0);
  const targetZRef  = useRef(STATIONS[0].z + 4.5);
  const yawRef      = useRef(0);
  const pitchRef    = useRef(0);
  const highlightsRef = useRef([]);
  const chairsRef   = useRef([]);   // [{group, glowPad, wx, wz}]
  const catRef      = useRef(null); // {group, tail}
  const catPosRef   = useRef({ x: 0, z: STATIONS[0].z });
  const keysRef     = useRef({});
  const walkRef     = useRef(0);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let raf, renderer;
    const cleanups = [];

    try {
      const W = () => mount.clientWidth;
      const H = () => mount.clientHeight;

      const scene  = new THREE.Scene();
      scene.background = new THREE.Color(0xe6d4a8);
      scene.fog = new THREE.Fog(0xe6d4a8, 14, 30);

      const camera = new THREE.PerspectiveCamera(55, W() / H(), 0.1, 100);
      camera.position.set(0, 1.6, STATIONS[0].z + 4.5);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(W(), H());
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xfff2d0, 0xb89a6a, 0.9));
      const sun = new THREE.DirectionalLight(0xfff0d0, 0.7);
      sun.position.set(-6, 12, 8);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
      sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
      sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
      sun.shadow.bias = -0.0005;
      scene.add(sun);

      const mat  = (c, r = 0.95, m = 0.0, e = {}) =>
        new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...e });
      const box  = (w, h, d, m) => {
        const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        me.castShadow = true; me.receiveShadow = true; return me;
      };
      const pbox = (w, h, d, m, x, y, z) => { const b = box(w, h, d, m); b.position.set(x, y, z); return b; };

      // ── комната ──────────────────────────────────────────────
      const DEPTH = 32, WIDTH = 10, WALL_H = 5;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), mat(0xb06a3e, 0.97));
      floor.rotation.x = -Math.PI / 2; floor.position.z = -3; floor.receiveShadow = true; scene.add(floor);

      const wallMat = mat(0xd9c189, 0.98);
      const bw = box(WIDTH, WALL_H, 0.2, wallMat); bw.position.set(0, WALL_H/2, -14); scene.add(bw);
      const lw = box(0.2, WALL_H, DEPTH, wallMat); lw.position.set(-WIDTH/2, WALL_H/2, -3); scene.add(lw);
      const rw = box(0.2, WALL_H, DEPTH, wallMat); rw.position.set( WIDTH/2, WALL_H/2, -3); scene.add(rw);

      const glassMat = new THREE.MeshStandardMaterial({ color: 0xb7c4b0, roughness: 0.5,
        transparent: true, opacity: 0.42, emissive: 0x9aae9a, emissiveIntensity: 0.2 });
      for (let i = 0; i < 4; i++) {
        const z = 6 - i * 5;
        const g  = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2), glassMat);
        g.position.set(-WIDTH/2 + 0.12, 3, z); g.rotation.y = Math.PI/2; scene.add(g);
        const g2 = g.clone(); g2.position.set(WIDTH/2 - 0.12, 3, z); g2.rotation.y = -Math.PI/2; scene.add(g2);
      }

      // ── столы (мониторы к зрителю, rotation.y = π) ──────────
      const woodTop = mat(0x8a5a32, 0.85), woodLeg = mat(0x6e4525, 0.85), chMat = mat(0x3d3128, 0.9);

      const glowMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8,
      });

      const chairs   = [];
      const screens  = [];

      function makeDesk(x, deskZ) {
        const g = new THREE.Group();

        // столешница
        const top = box(2.4, 0.12, 1.2, woodTop); top.position.y = 1.4; g.add(top);
        [[-1.05,-0.45],[1.05,-0.45],[-1.05,0.45],[1.05,0.45]].forEach(([lx,lz]) => {
          const l = box(0.12, 1.4, 0.12, woodLeg); l.position.set(lx, 0.7, lz); g.add(l);
        });

        // монитор
        const mon = new THREE.Group();
        mon.add(pbox(0.5, 0.05, 0.32, mat(0x4a4438,0.8), 0, 0.025, 0));
        mon.add(pbox(0.08, 0.36, 0.08, mat(0x4a4438,0.8), 0, 0.21, 0));
        const monBody = box(1.3, 0.78, 0.06, mat(0x3d3128,0.8)); monBody.position.set(0, 0.74, 0); mon.add(monBody);
        const screenMat = new THREE.MeshStandardMaterial({ color: 0x5f8a80, emissive: 0x5f8a80, emissiveIntensity: 0.35, roughness: 0.6 });
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.66), screenMat);
        screen.position.set(0, 0.74, 0.04); mon.add(screen);
        mon.position.set(0, 1.46, -0.15); g.add(mon);
        screens.push(screenMat);

        // стул — перед столом (local z = -1.0), со стороны зрителя
        const chair = new THREE.Group();
        const chairSeat = box(0.7, 0.12, 0.66, chMat); chairSeat.position.y = 0.92; chair.add(chairSeat);
        // спинка со стороны зрителя (+z от сиденья)
        const chairBack = box(0.7, 0.8, 0.12, chMat); chairBack.position.set(0, 1.36, 0.34); chair.add(chairBack);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.5,12), mat(0x55493a,0.7));
        col.position.y = 0.6; col.castShadow = true; chair.add(col);
        // стул перед столом — к зрителю (+z)
        chair.position.set(0, 0, 1.0); g.add(chair);

        // светящийся пад — там же где стул
        const gpad = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.7), glowMat.clone());
        gpad.rotation.x = -Math.PI/2; gpad.position.set(0, 0.01, 1.0);
        gpad.visible = false; g.add(gpad);

        // rotation.y = 0 → монитор (PlaneGeometry) смотрит в +Z = к зрителю
        g.position.set(x, 0, deskZ);
        g.rotation.y = 0;
        scene.add(g);

        // стул при rotation=0 в local z=+1.0 → world z = deskZ + 1.0 (между столом и зрителем)
        const wx = x;
        const wz = deskZ + 1.0;
        chairs.push({ group: chair, glowPad: gpad, wx, wz });
      }

      DESK_ZS.forEach(z => {
        makeDesk(-2.7, z);
        makeDesk( 2.7, z);
      });

      chairsRef.current  = chairs;
      highlightsRef.current = screens;

      // растение
      const plant = new THREE.Group();
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.26,0.55,18), mat(0xb5613f,0.9));
      pot.position.y = 0.27; pot.castShadow = true; plant.add(pot);
      [[0,0.95,0,0.5],[0.22,1.25,0.1,0.36],[-0.18,1.2,-0.1,0.38]].forEach(([px,py,pz,r]) => {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(r,14,14), mat(0x76814a,0.95));
        leaf.position.set(px,py,pz); leaf.castShadow = true; plant.add(leaf);
      });
      plant.position.set(3.8, 0, 9); scene.add(plant);

      // ── чёрная кошка на табуретке ─────────────────────────────
      const catGroup = new THREE.Group();

      // табуретка
      const stoolSeat = box(0.5, 0.05, 0.5, mat(0x8a5a32,0.85)); stoolSeat.position.y = 0.62; catGroup.add(stoolSeat);
      [[-0.19,-0.19],[0.19,-0.19],[-0.19,0.19],[0.19,0.19]].forEach(([lx,lz]) => {
        const leg = box(0.05, 0.62, 0.05, mat(0x6e4525,0.85)); leg.position.set(lx,0.31,lz); catGroup.add(leg);
      });

      // сама кошка — модель из Blender (public/models/cat.glb, исходник cat_model.blend):
      // узел CatBody и отдельный узел Tail с центром у основания хвоста, чтобы им вилять.
      // Начало координат модели — на сиденье табуретки, в файле мордой к -Z.
      const tailPivot = new THREE.Group();   // заглушка, пока модель грузится
      catRef.current = { group: catGroup, tail: tailPivot };
      let disposed = false;
      new GLTFLoader().load(ASSET + "models/cat.glb", (gltf) => {
        if (disposed) return;
        const cat = gltf.scene;
        cat.position.y = 0.645;               // верх сиденья
        cat.scale.setScalar(0.95);
        // мордой к зрителю при rotation.y группы = 0; при ходьбе (W → π) смотрит по ходу движения
        cat.rotation.y = Math.PI;
        cat.traverse(o => { if (o.isMesh) o.castShadow = true; });
        catGroup.add(cat);
        const tail = cat.getObjectByName("Tail");
        if (tail && catRef.current) catRef.current.tail = tail;
      }, undefined, (e) => setErr("Не удалось загрузить кошку: " + (e?.message || e)));
      cleanups.push(() => { disposed = true; });

      catGroup.position.set(0, 0, STATIONS[0].z);
      scene.add(catGroup);
      catPosRef.current = { x: 0, z: STATIONS[0].z };

      // ── управление ───────────────────────────────────────────
      const setCam = () => {
        const yaw = yawRef.current, pitch = pitchRef.current;
        const dir = new THREE.Vector3(
          Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch));
        camera.lookAt(camera.position.clone().add(dir));
      };
      setCam();

      const el = renderer.domElement;
      let dragging = false, lastX = 0, lastY = 0;
      const onDown = (e) => { dragging=true; lastX=e.clientX; lastY=e.clientY; el.setPointerCapture(e.pointerId); };
      const onMove = (e) => {
        if (!dragging) return;
        const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY;
        yawRef.current   = Math.max(-0.9, Math.min(0.9, yawRef.current   + dx*0.004));
        pitchRef.current = Math.max(-0.35,Math.min(0.35,pitchRef.current - dy*0.004));
      };
      const onUp = () => { dragging=false; };
      el.addEventListener("pointerdown",  onDown);
      el.addEventListener("pointermove",  onMove);
      el.addEventListener("pointerup",    onUp);
      el.addEventListener("pointercancel",onUp);
      cleanups.push(() => {
        el.removeEventListener("pointerdown",  onDown);
        el.removeEventListener("pointermove",  onMove);
        el.removeEventListener("pointerup",    onUp);
        el.removeEventListener("pointercancel",onUp);
      });

      const onKeyDown = (e) => { keysRef.current[e.key.toLowerCase()] = true; };
      const onKeyUp   = (e) => { keysRef.current[e.key.toLowerCase()] = false; };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup",   onKeyUp);
      cleanups.push(() => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup",   onKeyUp);
      });

      const onResize = () => { camera.aspect=W()/H(); camera.updateProjectionMatrix(); renderer.setSize(W(),H()); };
      window.addEventListener("resize", onResize);
      cleanups.push(() => window.removeEventListener("resize", onResize));

      // ── анимация ─────────────────────────────────────────────
      const SPEED = 0.09;
      let t = 0;
      const tick = () => {
        t += 0.03;

        // камера — станции
        const tz = targetZRef.current;
        camera.position.z += (tz - camera.position.z) * 0.06;
        if (!dragging) {
          yawRef.current   += (0 - yawRef.current)   * 0.04;
          pitchRef.current += (0 - pitchRef.current) * 0.04;
        }

        // WASD — кошка
        const keys = keysRef.current;
        const cp = catPosRef.current;
        if (keys["w"] || keys["arrowup"])    cp.z -= SPEED;
        if (keys["s"] || keys["arrowdown"])  cp.z += SPEED;
        if (keys["a"] || keys["arrowleft"])  cp.x -= SPEED;
        if (keys["d"] || keys["arrowright"]) cp.x += SPEED;
        cp.x = Math.max(-4.2, Math.min(4.2, cp.x));
        cp.z = Math.max(-13,  Math.min(10,  cp.z));

        const moving = (keys["w"]||keys["s"]||keys["a"]||keys["d"]||
                        keys["arrowup"]||keys["arrowdown"]||keys["arrowleft"]||keys["arrowright"]) ? 1 : 0;
        walkRef.current += (moving - walkRef.current) * 0.15;
        const walk = walkRef.current;

        const c = catRef.current;
        if (c) {
          c.group.position.x += (cp.x - c.group.position.x) * 0.14;
          c.group.position.z += (cp.z - c.group.position.z) * 0.14;
          c.group.position.y  = Math.abs(Math.sin(t * 8)) * 0.025 * walk;
          // хвост лежит на сиденье — машет из стороны в сторону
          c.tail.rotation.y = Math.sin(t * 3) * 0.12;   // основание внутри тела — небольшой размах
          // поворот по направлению движения
          if (keys["a"] || keys["arrowleft"])  c.group.rotation.y = -Math.PI/2;
          if (keys["d"] || keys["arrowright"]) c.group.rotation.y =  Math.PI/2;
          if (keys["w"] || keys["arrowup"])    c.group.rotation.y =  Math.PI;
          if (keys["s"] || keys["arrowdown"])  c.group.rotation.y =  0;
        }

        // стулья — исчезают когда кошка рядом
        chairsRef.current.forEach(({ group, glowPad, wx, wz }) => {
          const dx = cp.x - wx, dz = cp.z - wz;
          const near = Math.sqrt(dx*dx + dz*dz) < 1.1;
          group.visible   = !near;
          glowPad.visible =  near;
          if (near) glowPad.material.emissiveIntensity = 0.6 + Math.sin(t*4)*0.3;
        });

        // подсветка экранов
        highlightsRef.current.forEach((sm, i) => {
          const active = i === idxRef.current;
          const tgt = active ? 0.75 + Math.sin(t)*0.15 : 0.3;
          sm.emissiveIntensity += (tgt - sm.emissiveIntensity) * 0.08;
        });

        setCam();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      setErr(String(e && e.message ? e.message : e));
    }

    return () => {
      cancelAnimationFrame(raf);
      cleanups.forEach(fn => fn());
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement?.parentNode)
          renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  const go = (dir) => {
    const next = Math.max(0, Math.min(STATIONS.length-1, idxRef.current+dir));
    idxRef.current = next; setIdx(next);
    targetZRef.current = STATIONS[next].z + 4.5;
  };

  const st = STATIONS[idx];
  const atStart = idx===0, atEnd = idx===STATIONS.length-1;

  const grain = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E";

  return (
    <div style={{ position:"relative", width:"100%", height:"100vh", overflow:"hidden",
      background:"#e6d4a8", fontFamily:"ui-sans-serif, system-ui, sans-serif", touchAction:"none" }}>
      <style>{`@keyframes cardIn{from{opacity:0;transform:translate(-50%,calc(-50% + 8px))}to{opacity:1;transform:translate(-50%,-50%)}}`}</style>
      <div ref={mountRef} style={{ position:"absolute", inset:0 }} />

      <div style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:40,
        backgroundImage:`url("${grain}")`, mixBlendMode:"multiply", opacity:0.16 }} />
      <div style={{ position:"absolute", inset:0, pointerEvents:"none", zIndex:41,
        background:"radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 55%, rgba(70,45,20,0.35) 100%)" }} />

      {err && (
        <div style={{ position:"absolute", top:16, left:14, right:14, background:"#b5524a", zIndex:60,
          color:"#fff", fontFamily:"ui-monospace,monospace", fontSize:12, padding:"10px 12px", borderRadius:10 }}>
          Ошибка: {err}
        </div>
      )}

      <div style={{ position:"absolute", top:16, left:"50%", transform:"translateX(-50%)", display:"flex", gap:7, zIndex:50 }}>
        {STATIONS.map((s,i) => (
          <div key={i} style={{ width:i===idx?22:7, height:7, borderRadius:999,
            background:i===idx?st.accent:"rgba(70,55,40,0.3)", transition:"all .3s" }} />
        ))}
      </div>

      <div key={idx} style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", zIndex:50,
        width:"min(86vw,380px)", background:"rgba(251,243,224,0.95)", backdropFilter:"blur(6px)",
        borderRadius:16, padding:"16px 18px", boxShadow:"0 10px 34px rgba(60,40,15,0.22)",
        animation:"cardIn .45s ease both", borderTop:`3px solid ${st.accent}` }}>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:st.accent }}>{st.tag}</div>
        <div style={{ fontSize:19, fontWeight:700, color:"#3a3128", marginTop:4 }}>{st.title}</div>
        <div style={{ fontSize:13.5, lineHeight:1.5, color:"#6b5d48", marginTop:6 }}>{st.desc}</div>
      </div>

      <div style={{ position:"absolute", bottom:20, left:"50%", transform:"translateX(-50%)", display:"flex", gap:10, alignItems:"center", zIndex:50 }}>
        <button onClick={() => go(-1)} disabled={atStart} style={navBtn(atStart,false,st.accent)}>← Назад</button>
        <button onClick={() => go(1)}  disabled={atEnd}   style={navBtn(atEnd,  true, st.accent)}>{atEnd?"Конец":"Дальше →"}</button>
      </div>

      <div style={{ position:"absolute", bottom:64, left:0, right:0, textAlign:"center", fontSize:11, color:"#7a6a50", pointerEvents:"none", zIndex:50 }}>
        WASD — двигай кошку · тяни пальцем — оглядеться
      </div>
    </div>
  );
}

function navBtn(disabled, primary, accent) {
  return {
    border:0, cursor:disabled?"default":"pointer", font:"inherit", fontSize:14, fontWeight:600,
    padding:"11px 20px", borderRadius:999,
    color: primary?"#fbf3e0":"#f0e4c8",
    background: primary?accent:"rgba(61,49,40,0.85)",
    opacity:disabled?0.4:1, boxShadow:"0 6px 20px rgba(60,40,15,0.2)", transition:"opacity .2s",
  };
}
