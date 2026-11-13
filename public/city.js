// Cidade em volta do escritório: o escritório é a cobertura de uma torre no meio de uma Manhattan
// procedural (quarteirões em grade, prédios escalonados, caixas d'água, parque, rio e trânsito com táxis).
// A luz segue o sol de verdade: posição calculada pela data/hora atual em São Paulo (fuso da empresa).
// Para conferir outro horário: ?hora=21:30 na URL.
import * as THREE from 'three';

export const GROUND = -64; // nível da rua (o piso do escritório fica em y = 0)
const LAT = -23.55, LON = -46.63; // São Paulo
const BLOCK = 64, STREET = 18, LOT = (BLOCK - STREET) / 2; // quarteirão 50 × 50, 4 lotes de 25
const N = 5; // quarteirões para cada lado
const SPAN = (N + 0.5) * BLOCK; // até onde vão as ruas

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerpC = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);

// ---------------- sol ----------------
// Posição aparente do sol (aproximação usual do almanaque, erro < 1°). Devolve altitude e azimute em graus
// (azimute a partir do norte, sentido horário).
export function sunPosition(date, lat = LAT, lon = LON) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 864e5 + 2440587.5 - 2451545;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha) * Math.cos(dec), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(ha));
  return { alt: alt / rad, az: ((az / rad) + 360) % 360 };
}

function clockNow() {
  const want = new URLSearchParams(location.search).get('hora');
  const m = want && /^(\d{1,2})(?::(\d{2}))?$/.exec(want);
  if (!m) return new Date();
  // hora pedida no fuso de São Paulo (UTC-3), no dia de hoje
  const d = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  return new Date(`${day}T${m[1].padStart(2, '0')}:${m[2] || '00'}:00-03:00`);
}

// ---------------- material com janelas ----------------
// Janelas desenhadas no shader a partir da posição no mundo (servem para qualquer prédio, instanciado ou não).
// De dia: vidro escuro. À noite: parte das janelas acende (quente ou fria), sorteada por janela.
function windowMaterial(uniforms, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0.05, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vCityN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 cwp = vec4(transformed, 1.0);
        vec3 cn = objectNormal;
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp; cn = mat3(instanceMatrix) * cn;
        #endif
        vCityPos = (modelMatrix * cwp).xyz;
        vCityN = normalize(mat3(modelMatrix) * cn);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCityPos;
        varying vec3 vCityN;
        uniform float uNight;
        float cityHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 cN = normalize(vCityN);
        if (abs(cN.y) < 0.5) {
          float u = abs(cN.x) > abs(cN.z) ? vCityPos.z : vCityPos.x;
          vec2 cell = vec2(u / 2.4, (vCityPos.y + 0.6) / 3.2);
          vec2 f = fract(cell);
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.24, f.y) * step(f.y, 0.80);
          vec2 id = floor(cell) + vec2(sign(cN.x) * 17.0, sign(cN.z) * 31.0) + floor(vCityPos.xz / 25.0) * 7.13;
          float r = cityHash(id);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.16, 0.2) + 0.1 * r, win * 0.9);
          roughnessFactor = mix(roughnessFactor, 0.25, win);
          float lit = step(0.5, r) * uNight;
          vec3 tone = mix(vec3(1.0, 0.76, 0.42), vec3(0.78, 0.88, 1.0), step(0.86, cityHash(id + 3.1)));
          totalEmissiveRadiance += tone * lit * win * (0.55 + 0.75 * cityHash(id + 7.7));
        } else if (cN.y > 0.5) {
          diffuseColor.rgb *= 0.72;
        }`);
  };
  return m;
}

export class City {
  constructor(scene, { sun, hemi, fill, renderer }) {
    this.scene = scene;
    this.lights = { sun, hemi, fill };
    this.renderer = renderer;
    this.uniforms = { uNight: { value: 0 } };
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rand = rng(20261113);
    this.buildGround();
    this.buildTower();
    this.buildBlocks();
    this.buildTraffic();
    this.buildOfficeLights();
    this.lastSky = -1e9;
    this.applySky();
  }

  // ---------------- chão: asfalto, calçadas, faixas, parque e rio ----------------
  buildGround() {
    const g = this.group;
    this.asphalt = new THREE.MeshStandardMaterial({ color: '#2c2d2f', roughness: 0.95 });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 2 + 600, SPAN * 2 + 600), this.asphalt);
    road.rotation.x = -Math.PI / 2; road.position.y = GROUND;
    g.add(road);
    // calçadas (um bloco elevado por quarteirão)
    const walk = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK - STREET, 0.3, BLOCK - STREET), new THREE.MeshStandardMaterial({ color: '#9a978f', roughness: 0.9 }), (2 * N + 1) ** 2);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) { m.makeTranslation(i * BLOCK, GROUND + 0.15, j * BLOCK); walk.setMatrixAt(k++, m); }
    g.add(walk);
    // faixa dupla amarela no meio de cada rua
    const lineMat = new THREE.MeshBasicMaterial({ color: '#c9a400' });
    for (let s = -N; s < N; s++) {
      const c = s * BLOCK + BLOCK / 2;
      for (const off of [-0.25, 0.25]) {
        const a = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 2, 0.18), lineMat); a.rotation.x = -Math.PI / 2; a.position.set(0, GROUND + 0.02, c + off); g.add(a);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(0.18, SPAN * 2), lineMat); b.rotation.x = -Math.PI / 2; b.position.set(c + off, GROUND + 0.02, 0); g.add(b);
      }
    }
    // parque (dois quarteirões juntos, com árvores)
    this.park = { i: -2, j0: -2, j1: -1 };
    const pw = BLOCK - STREET, ph = BLOCK * 2 - STREET;
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.4, ph), new THREE.MeshStandardMaterial({ color: '#5f7d4a', roughness: 1 }));
    lawn.position.set(this.park.i * BLOCK, GROUND + 0.2, (this.park.j0 + this.park.j1) / 2 * BLOCK);
    g.add(lawn);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(7, 24), new THREE.MeshStandardMaterial({ color: '#3d5f73', roughness: 0.2 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(this.park.i * BLOCK + 6, GROUND + 0.42, lawn.position.z - 12); g.add(pond);
    const trees = 70;
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.8, 0), new THREE.MeshStandardMaterial({ color: '#4f7a43', flatShading: true }), trees);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.2), new THREE.MeshStandardMaterial({ color: '#6b4a2f' }), trees);
    const tint = new THREE.Color();
    for (let t = 0; t < trees; t++) {
      let x, z;
      do { x = lawn.position.x + (this.rand() - 0.5) * (pw - 4); z = lawn.position.z + (this.rand() - 0.5) * (ph - 4); } while (Math.hypot(x - pond.position.x, z - pond.position.z) < 8.5);
      const s = 0.8 + this.rand() * 0.7;
      m.compose(new THREE.Vector3(x, GROUND + 0.4 + 2.6 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 1.2, s)); crowns.setMatrixAt(t, m);
      crowns.setColorAt(t, tint.set(['#4f7a43', '#5d7a4a', '#3f6b3a', '#6b8a4a'][t % 4]));
      m.makeTranslation(x, GROUND + 1.5, z); trunks.setMatrixAt(t, m);
    }
    g.add(crowns, trunks);
    // rio a oeste
    const river = new THREE.Mesh(new THREE.PlaneGeometry(400, SPAN * 2 + 600), new THREE.MeshStandardMaterial({ color: '#3a5566', roughness: 0.15, metalness: 0.2 }));
    river.rotation.x = -Math.PI / 2; river.position.set(-SPAN - 200 - 6, GROUND + 0.05, 0); g.add(river);
  }

  // ---------------- a torre do escritório ----------------
  buildTower() {
    const g = this.group;
    const h = -GROUND - 0.3;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(48, h, 34), windowMaterial(this.uniforms, { color: '#b9b4a8' }));
    tower.position.y = GROUND + h / 2 - 0.3;
    g.add(tower);
    const concrete = new THREE.MeshStandardMaterial({ color: '#bdb9ae', roughness: 0.9 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(49.6, 0.4, 35.6), concrete); slab.position.y = -0.3; slab.receiveShadow = true; g.add(slab);
    const edge = new THREE.MeshStandardMaterial({ color: '#8f8b82', roughness: 0.8 });
    for (const [w, d, x, z] of [[49.6, 0.3, 0, 17.65], [49.6, 0.3, 0, -17.65], [0.3, 35.6, 24.65, 0], [0.3, 35.6, -24.65, 0]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), edge); p.position.set(x, 0.25, z); p.castShadow = true; p.receiveShadow = true; g.add(p);
    }
    // marquise e portaria lá embaixo, virada para a rua de frente para a câmera
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 4), new THREE.MeshStandardMaterial({ color: '#1c1d1c', roughness: 0.5 }));
    lobby.position.set(0, GROUND + 5, 19); g.add(lobby);
    this.tower = tower;
  }

  // ---------------- quarteirões ----------------
  buildBlocks() {
    const boxes = [], tanks = [];
    const PALETTE = ['#8a5a44', '#9c6b52', '#c9bfae', '#b7ab96', '#a89f91', '#6d747a', '#4f5a63', '#d6cfc0', '#7d6a58', '#b49a7e'];
    const R = this.rand;
    const add = (x, z, w, d, y0, h, color) => boxes.push({ x, z, w, d, y0, h, color });
    for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
      if (i === 0 && j === 0) continue;
      if (i === this.park.i && j >= this.park.j0 && j <= this.park.j1) continue;
      const dist = Math.hypot(i, j) * BLOCK;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const cx = i * BLOCK + (a - 0.5) * LOT, cz = j * BLOCK + (b - 0.5) * LOT;
        const w = LOT - 2 - R() * 5, d = LOT - 2 - R() * 5;
        // perto da torre os prédios são baixos (não tapam o escritório e deixam ver as ruas); longe, sobem
        const h = dist < 100 ? 12 + R() * 30 : dist < 170 ? (R() < 0.25 ? 70 + R() * 50 : 18 + R() * 50) : 30 + R() * 110;
        const color = PALETTE[(R() * PALETTE.length) | 0];
        if (h > 70 && R() < 0.75) {
          // escalonado (art déco): base, corpo e topo cada vez mais finos
          const h1 = h * 0.5, h2 = h * 0.32, h3 = h - h1 - h2;
          add(cx, cz, w, d, GROUND, h1, color);
          add(cx, cz, w * 0.78, d * 0.78, GROUND + h1, h2, color);
          add(cx, cz, w * 0.52, d * 0.52, GROUND + h1 + h2, h3, color);
        } else {
          add(cx, cz, w, d, GROUND, h, color);
          if (h < 55 && R() < 0.45) tanks.push({ x: cx + (R() - 0.5) * w * 0.5, z: cz + (R() - 0.5) * d * 0.5, y: GROUND + h });
        }
      }
    }
    // marcos no horizonte (atrás do escritório, do ponto de vista da câmera)
    const landmark = (x, z, base, color) => {
      add(x, z, 22, 22, GROUND, 70, color); add(x, z, 16, 16, GROUND + 70, 45, color);
      add(x, z, 11, 11, GROUND + 115, 30, color); add(x, z, 6, 6, GROUND + 145, 12, color);
      return GROUND + 157 + base;
    };
    const top1 = landmark(-3 * BLOCK, -4 * BLOCK + LOT / 2, 0, '#c9bfae');
    this.spires = [[-3 * BLOCK, -4 * BLOCK + LOT / 2, top1, 26]];
    add(-4 * BLOCK - LOT / 2, -1 * BLOCK, 20, 20, GROUND, 190, '#4f5a63');
    this.spires.push([-4 * BLOCK - LOT / 2, -1 * BLOCK, GROUND + 190, 30]);

    const mat = windowMaterial(this.uniforms);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    boxes.forEach((b, k) => {
      m.compose(new THREE.Vector3(b.x, b.y0 + b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(k, m); mesh.setColorAt(k, c.set(b.color));
    });
    this.group.add(mesh);
    // antenas dos marcos (com luz vermelha piscando à noite)
    const spireMat = new THREE.MeshStandardMaterial({ color: '#9a9c9e', metalness: 0.6, roughness: 0.35 });
    this.beacons = [];
    for (const [x, z, y, len] of this.spires) {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.9, len, 8), spireMat); sp.position.set(x, y + len / 2, z); this.group.add(sp);
      const bc = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff3b2f', toneMapped: false })); bc.position.set(x, y + len, z); this.group.add(bc);
      this.beacons.push(bc);
    }
    // caixas d'água de madeira nos telhados (a cara de Nova York)
    const legs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.7, 1.7, 1.6, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#3a3b38', side: THREE.DoubleSide }), tanks.length);
    const barrel = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 14), new THREE.MeshStandardMaterial({ color: '#7a5537', roughness: 0.9 }), tanks.length);
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 1.3, 14), new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.8 }), tanks.length);
    tanks.forEach((t, k) => {
      m.makeTranslation(t.x, t.y + 0.8, t.z); legs.setMatrixAt(k, m);
      m.makeTranslation(t.x, t.y + 3.1, t.z); barrel.setMatrixAt(k, m);
      m.makeTranslation(t.x, t.y + 5.25, t.z); cone.setMatrixAt(k, m);
    });
    this.group.add(legs, barrel, cone);
    // postes de luz nas esquinas (acendem à noite)
    const lamps = [];
    for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
      const half = (BLOCK - STREET) / 2 - 0.6;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) lamps.push([i * BLOCK + sx * half, j * BLOCK + sz * half]);
      for (const s of [-1, 1]) { lamps.push([i * BLOCK, j * BLOCK + s * half]); lamps.push([i * BLOCK + s * half, j * BLOCK]); }
    }
    this.lampMat = new THREE.MeshBasicMaterial({ color: '#ffd58a', toneMapped: false, transparent: true, opacity: 0 });
    const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 8, 6), this.lampMat, lamps.length);
    lamps.forEach(([x, z], k) => { m.makeTranslation(x, GROUND + 5, z); lampMesh.setMatrixAt(k, m); });
    this.group.add(lampMesh);
    this.lampMesh = lampMesh;
  }

  // ---------------- trânsito ----------------
  buildTraffic() {
    const R = this.rand;
    const COUNT = 170;
    const COLORS = ['#f2c200', '#f2c200', '#f2c200', '#e8e6df', '#1c1d1c', '#2e5e8c', '#8a1c1c', '#5f6366', '#c9c6bd'];
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.75, 4.3), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 }), COUNT);
    const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.6, 2.2), new THREE.MeshStandardMaterial({ color: '#222629', roughness: 0.15, metalness: 0.4 }), COUNT);
    this.headMat = new THREE.MeshBasicMaterial({ color: '#fff6d8', toneMapped: false });
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.2, 0.12), this.headMat, COUNT);
    const tail = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.2, 0.12), new THREE.MeshBasicMaterial({ color: '#ff3b2f', toneMapped: false }), COUNT);
    // faixa de luz dos faróis no asfalto (só à noite)
    this.beamMat = new THREE.MeshBasicMaterial({ color: '#fff1c4', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const beamGeo = new THREE.PlaneGeometry(2.2, 7); beamGeo.rotateX(-Math.PI / 2);
    const beam = new THREE.InstancedMesh(beamGeo, this.beamMat, COUNT);
    for (const im of [body, cabin, head, tail, beam]) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color();
    this.cars = [];
    const streets = [];
    for (let s = -N; s < N; s++) streets.push(s * BLOCK + BLOCK / 2);
    for (let k = 0; k < COUNT; k++) {
      const alongX = k % 2 === 0;
      const dir = R() < 0.5 ? 1 : -1;
      const line = streets[(R() * streets.length) | 0] + dir * (alongX ? 3.4 : -3.4);
      this.cars.push({ alongX, dir, line, s: (R() * 2 - 1) * SPAN, speed: 9 + R() * 9 });
      body.setColorAt(k, c.set(COLORS[(R() * COLORS.length) | 0]));
    }
    this.carMeshes = { body, cabin, head, tail, beam };
    this.group.add(body, cabin, head, tail, beam);
    this._m = new THREE.Matrix4(); this._o = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3();
    this.offsets = {
      body: new THREE.Matrix4().makeTranslation(0, 0.75, 0), cabin: new THREE.Matrix4().makeTranslation(0, 1.35, -0.2),
      head: new THREE.Matrix4().makeTranslation(0, 0.75, 2.17), tail: new THREE.Matrix4().makeTranslation(0, 0.8, -2.17),
      beam: new THREE.Matrix4().makeTranslation(0, 0.05, 5.8),
    };
    this.updateCars(0);
  }

  updateCars(dt) {
    const { _m: m, _o: o, _q: q, _p: p } = this;
    const up = new THREE.Vector3(0, 1, 0);
    this.cars.forEach((car, k) => {
      car.s += car.speed * car.dir * dt;
      if (car.s > SPAN) car.s -= SPAN * 2; else if (car.s < -SPAN) car.s += SPAN * 2;
      if (car.alongX) { p.set(car.s, GROUND + 0.3, car.line); q.setFromAxisAngle(up, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2); }
      else { p.set(car.line, GROUND + 0.3, car.s); q.setFromAxisAngle(up, car.dir > 0 ? 0 : Math.PI); }
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      for (const [name, im] of Object.entries(this.carMeshes)) im.setMatrixAt(k, o.multiplyMatrices(m, this.offsets[name]));
    });
    for (const im of Object.values(this.carMeshes)) im.instanceMatrix.needsUpdate = true;
  }

  // ---------------- luzes do escritório à noite ----------------
  buildOfficeLights() {
    this.officeLights = [[-12, -6], [12, -6], [-12, 8], [12, 8]].map(([x, z]) => {
      const l = new THREE.PointLight('#ffe2b0', 0, 30, 1);
      l.position.set(x, 7, z);
      this.scene.add(l);
      return l;
    });
  }

  // ---------------- céu e luz conforme o horário ----------------
  applySky() {
    const { alt, az } = sunPosition(clockNow());
    this.sky = { alt, az };
    const day = smooth(-10, 8, alt); // 0 = noite, 1 = dia (crepúsculo no meio)
    const golden = smooth(-4, 2, alt) * (1 - smooth(4, 16, alt)); // nascer/pôr do sol
    const night = 1 - smooth(-9, 3, alt);
    this.night = night;
    this.uniforms.uNight.value = night;
    const { sun, hemi, fill } = this.lights;
    // norte = -z, leste = +x
    const r = Math.PI / 180;
    const useAlt = Math.max(alt, 12) * r; // abaixo disso a sombra fica longa demais; a luz já está fraca
    const dir = alt > -4
      ? new THREE.Vector3(Math.sin(az * r) * Math.cos(useAlt), Math.sin(useAlt), -Math.cos(az * r) * Math.cos(useAlt))
      : new THREE.Vector3(-0.35, 0.85, 0.4).normalize(); // lua
    sun.position.copy(dir.multiplyScalar(60));
    sun.color.copy(alt > -4 ? lerpC('#fff6e6', '#ffb070', golden) : new THREE.Color('#9fb4ff'));
    sun.intensity = alt > -4 ? 0.25 + 1.45 * day : 0.22;
    hemi.color.copy(lerpC('#6576a8', '#ffffff', day));
    hemi.groundColor.copy(lerpC('#1a1c22', '#9c998f', day));
    hemi.intensity = 0.45 + 0.8 * day;
    fill.intensity = 0.08 + 0.27 * day;
    const sky = lerpC(lerpC('#0e1524', '#3a3d5c', smooth(-14, -4, alt)), lerpC('#e2b48e', '#cdd8df', smooth(2, 18, alt)), smooth(-5, 3, alt));
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.renderer.toneMappingExposure = 0.95 + 0.13 * day;
    this.asphalt.emissive.set('#3a2a14').multiplyScalar(night * 0.35);
    this.lampMat.opacity = night;
    this.beamMat.opacity = night * 0.16;
    this.headMat.color.copy(lerpC('#d9d6cc', '#fff6d8', night));
    for (const l of this.officeLights) l.intensity = night * 7;
  }

  update(dt, now) {
    this.updateCars(dt);
    if (now - this.lastSky > 30_000) { this.lastSky = now; this.applySky(); }
    if (this.beacons) { const on = this.night > 0.3 && Math.floor(now / 900) % 2 === 0; for (const b of this.beacons) b.visible = on; }
  }
}
