// Personagens 3D (KayKit, CC0): catálogo, aparência de cada agente e animações de verdade.
// Os modelos têm peças separadas (cabeça, corpo, braços, pernas e acessórios) no mesmo esqueleto (Rig_Medium),
// então cada agente escolhe o personagem, liga/desliga acessórios, a cor da roupa e um objeto na mão.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const BASE = '/assets/kaykit';
export const CHARACTERS = [
  { key: 'knight', label: 'Cavaleiro', file: 'Knight.glb' },
  { key: 'barbarian', label: 'Bárbaro', file: 'Barbarian.glb' },
  { key: 'mage', label: 'Mago', file: 'Mage.glb' },
  { key: 'rogue', label: 'Ladino', file: 'Rogue.glb' },
  { key: 'rogue_hooded', label: 'Ladino encapuzado', file: 'Rogue_Hooded.glb' },
  { key: 'ranger', label: 'Patrulheiro', file: 'Ranger.glb' },
  // KayKit Skeletons 1.0 (CC0), mesmo esqueleto: "extra" = fora do sorteio da aparência padrão,
  // para não mudar o visual de quem nunca escolheu um personagem.
  { key: 'skeleton_warrior', label: 'Esqueleto guerreiro', file: 'Skeleton_Warrior.glb', extra: true },
  { key: 'skeleton_rogue', label: 'Esqueleto ladino', file: 'Skeleton_Rogue.glb', extra: true },
  { key: 'skeleton_mage', label: 'Esqueleto mago', file: 'Skeleton_Mage.glb', extra: true },
  { key: 'skeleton_minion', label: 'Esqueleto lacaio', file: 'Skeleton_Minion.glb', extra: true },
];
// Peças opcionais (acessórios) pelo sufixo do nome da malha.
export const PART_LABEL = { Helmet: 'Capacete', HelmetVisor: 'Viseira', Cape: 'Capa', Hat: 'Chapéu', BearHat: 'Chapéu de urso', Quiver: 'Aljava', Mask: 'Máscara', Cloak: 'Manto', Hood: 'Capuz' };
// partes do corpo (sempre visíveis): as dos esqueletos incluem olhos, mandíbula e crânio
const CORE = new Set(['Head', 'Body', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight', 'Eyes', 'Jaw', 'Skull']);
// Visual de escritório por padrão: sem viseira fechada nem máscara cobrindo o rosto.
const DEFAULT_OFF = new Set(['HelmetVisor', 'Mask', 'Quiver']);
export const ITEMS = [
  { key: '', label: 'Nada' },
  { key: 'mug', label: 'Caneca', file: 'items/mug_full.gltf' },
  { key: 'book', label: 'Caderno', file: 'items/spellbook_closed.gltf' },
];
// Arquivos de animação (Rig_Medium): General tem Idle_A; Simulation tem Waving e sentar; MovementBasic, andar;
// Tools, trabalhar. Quem só precisa de parte deles (ex.: a landing) passa { anims } e não espera os outros.
export const ANIM_SETS = ['General', 'MovementBasic', 'Simulation', 'Tools'];
const animFile = (n) => `animations/Rig_Medium_${n}.glb`;
const TARGET_HEIGHT = 2.05; // mesma altura dos bonecos antigos (cabe nas mesas e cadeiras)
const SEAT_Y = 0.64; // altura do assento das cadeiras do escritório

const loader = new GLTFLoader();
const cache = new Map();
const load = (url) => {
  if (!cache.has(url)) cache.set(url, new Promise((ok, fail) => loader.load(`${BASE}/${url}`, ok, undefined, fail)));
  return cache.get(url);
};
const clipsBySet = new Map();
function clips(sets = ANIM_SETS) {
  const key = sets.join(',');
  if (!clipsBySet.has(key)) {
    clipsBySet.set(key, Promise.all(sets.map((n) => load(animFile(n)))).then((gs) => {
      const m = new Map();
      for (const g of gs) for (const c of g.animations) if (c.name !== 'T-Pose' && !m.has(c.name)) m.set(c.name, c);
      return m;
    }));
  }
  return clipsBySet.get(key);
}

/** Começa a baixar personagens e animações antes de precisar deles (não espera). */
export function warm(chars = [], sets = ANIM_SETS) {
  for (const n of sets) load(animFile(n)).catch(() => {});
  for (const k of chars) { const c = CHARACTERS.find((x) => x.key === k); if (c) load(`characters/${c.file}`).catch(() => {}); }
}

// Caixa do personagem na pose atual (vértices com o esqueleto aplicado), no espaço do próprio modelo.
function measure(model) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3();
  model.traverse((o) => {
    if (!o.isSkinnedMesh || !o.visible) return;
    o.skeleton.update();
    o.computeBoundingBox();
    box.union(o.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
  });
  return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1.8, 1)) : box;
}

export const charKey = (k) => (CHARACTERS.some((c) => c.key === k) ? k : null);
/** Aparência padrão (determinística por id) quando o agente ainda não escolheu. */
export function defaultLook(id) {
  let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = CHARACTERS.filter((c) => !c.extra);
  return { char: pool[h % pool.length].key, parts: {}, outfit: 'agent', item: '', scale: 1 };
}
export function normalizeLook(look, id) {
  const d = defaultLook(id);
  const l = { ...d, ...(look || {}) };
  l.char = charKey(l.char) || d.char;
  l.parts = l.parts && typeof l.parts === 'object' ? l.parts : {};
  l.item = ITEMS.some((i) => i.key === l.item) ? l.item : '';
  l.scale = Math.min(1.15, Math.max(0.85, +l.scale || 1));
  return l;
}

/** Lista de acessórios de um personagem: [{suffix, label}] */
export async function partsOf(char) {
  const c = CHARACTERS.find((x) => x.key === char) || CHARACTERS[0];
  const g = await load(`characters/${c.file}`);
  const out = [];
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const suffix = o.name.split('_').pop();
    if (!CORE.has(suffix) && !out.some((p) => p.suffix === suffix)) out.push({ suffix, label: PART_LABEL[suffix] || suffix, on: !DEFAULT_OFF.has(suffix) });
  });
  return out;
}

/**
 * Prévia 3D (ficha do agente): o personagem girando devagar, acenando de vez em quando.
 * Devolve { set(look, color), dispose() }. Uma prévia por vez (cada uma tem seu próprio WebGL).
 */
export function preview(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 1.5, 5.6); cam.lookAt(0, 1.0, 0);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9b7b0', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6); sun.position.set(3, 5, 4); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.12 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const clock = new THREE.Clock();
  let ch = null, token = 0, raf = 0, waveAt = performance.now() + 1500, alive = true;
  const size = () => {
    const w = canvas.clientWidth || 260, h = canvas.clientHeight || 300;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  const loop = () => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (ch) {
      ch.root.rotation.y += dt * 0.5;
      if (performance.now() > waveAt) { ch.play('Waving', { once: true }); waveAt = performance.now() + 7000; }
      ch.update(dt);
    }
    renderer.render(scene, cam);
  };
  size(); loop();
  const ro = new ResizeObserver(size); ro.observe(canvas);
  return {
    async set(look, id, color) {
      const t = ++token;
      const next = await buildCharacter(look, id, color);
      if (t !== token || !alive) { next.dispose(); return; }
      const rot = ch ? ch.root.rotation.y : 0.6;
      if (ch) { scene.remove(ch.root); ch.dispose(); }
      ch = next; ch.root.rotation.y = rot;
      scene.add(ch.root); ch.play('Idle_A', { fade: 0 });
      // enquadra o personagem inteiro (com folga para acenar e para o chapéu)
      const H = ch.topY || 2;
      const dist = (H * 1.45) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
      cam.position.set(0, H * 0.62, dist);
      cam.lookAt(0, H * 0.5, 0);
      floor.scale.setScalar(Math.max(0.6, H / 2));
    },
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); if (ch) ch.dispose(); renderer.dispose(); },
  };
}

/**
 * Monta um personagem pronto para animar. color = cor do agente (para a roupa, se escolhido).
 * Devolve { root, mixer, play(name), update(dt), bones, sitY, dispose() }.
 */
export async function buildCharacter(lookIn, id, color, { anims } = {}) {
  const look = normalizeLook(lookIn, id);
  const c = CHARACTERS.find((x) => x.key === look.char);
  const [g, clipMap] = await Promise.all([load(`characters/${c.file}`), clips(anims)]);
  const model = cloneSkinned(g.scene);
  // materiais próprios (para tingir só este agente) e sombras
  const tint = look.outfit === 'agent' ? new THREE.Color(color || '#ffffff') : look.outfit && /^#[0-9a-f]{6}$/i.test(look.outfit) ? new THREE.Color(look.outfit) : null;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false; // malhas com esqueleto: a caixa de recorte não acompanha a animação
    const suffix = o.name.split('_').pop();
    if (!CORE.has(suffix)) o.visible = look.parts[suffix] ?? !DEFAULT_OFF.has(suffix);
    o.material = o.material.clone();
    // roupa: corpo, capa e chapéu ganham um toque da cor escolhida (rosto e mãos ficam naturais)
    if (tint && ['Body', 'Cape', 'Hat', 'BearHat', 'Helmet', 'Cloak', 'Hood'].includes(suffix)) o.material.color.copy(new THREE.Color('#ffffff').lerp(tint, 0.55));
  });
  const root = new THREE.Group();
  root.add(model);
  const bones = {};
  model.traverse((o) => { if (o.isBone) bones[o.name] = o; });

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map();
  const action = (name) => {
    if (!actions.has(name)) { const clip = clipMap.get(name); if (!clip) return null; actions.set(name, mixer.clipAction(clip)); }
    return actions.get(name);
  };
  // Altura real: mede os vértices já deformados pelo esqueleto na pose parada (a caixa do modelo "cru" engana).
  const idle = action('Idle_A');
  idle?.play(); mixer.update(0);
  const raw = measure(model);
  idle?.stop(); mixer.stopAllAction();
  const h = raw.max.y - raw.min.y || 1;
  const s = (TARGET_HEIGHT / h) * look.scale;
  model.scale.setScalar(s);
  model.position.y = -raw.min.y * s; // pés no chão
  const topY = h * s; // topo da cabeça/chapéu

  // objeto na mão direita
  if (look.item) {
    const it = ITEMS.find((i) => i.key === look.item);
    try {
      const ig = await load(it.file);
      const obj = ig.scene.clone();
      obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      bones['handslot.r']?.add(obj);
    } catch { /* item opcional */ }
  }

  // quanto o quadril desce ao sentar (para encaixar no assento da cadeira)
  let sitY = 0;
  const sit = action('Sit_Chair_Idle');
  if (sit && bones.hips) {
    model.updateMatrixWorld(true);
    const stand = new THREE.Vector3(); bones.hips.getWorldPosition(stand);
    sit.play(); mixer.update(0.01); model.updateMatrixWorld(true);
    const seated = new THREE.Vector3(); bones.hips.getWorldPosition(seated);
    sit.stop(); mixer.stopAllAction();
    sitY = SEAT_Y + 0.06 - seated.y; // quadril um pouco acima do assento
    void stand;
  }

  let current = null, onceUntil = 0;
  const api = {
    root, model, mixer, bones, sitY, look, topY,
    current: () => current,
    /** Troca de animação com transição suave. once=true toca uma vez e volta para a anterior. */
    play(name, { fade = 0.25, once = false, speed = 1 } = {}) {
      const next = action(name);
      if (!next) return;
      if (once) {
        next.reset(); next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = false; next.timeScale = speed;
        next.fadeIn(fade).play();
        if (current) current.fadeOut(fade);
        onceUntil = performance.now() + (next.getClip().duration / speed) * 1000 - fade * 1000;
        api._onceAction = next;
        return;
      }
      next.timeScale = speed;
      if (current === next) return;
      next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fade).play();
      if (current) current.fadeOut(fade);
      current = next;
    },
    busyOnce: () => performance.now() < onceUntil,
    update(dt) {
      if (api._onceAction && performance.now() >= onceUntil) {
        api._onceAction.fadeOut(0.25);
        if (current) current.reset().fadeIn(0.25).play();
        api._onceAction = null;
      }
      mixer.update(dt);
    },
    dispose() { mixer.stopAllAction(); model.traverse((o) => { if (o.isMesh) o.material.dispose(); }); },
  };
  return api;
}
