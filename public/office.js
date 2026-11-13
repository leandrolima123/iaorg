// Escritório 3D isométrico: cenário, avatares dos agentes, etiquetas e animações.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildCharacter } from './avatars.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Móveis KayKit Furniture Bits (CC0). Mesma escala dos personagens KayKit (0,86) e virados para +z.
const FURN = '/assets/kaykit/furniture';
const KK = 0.86;
const furnLoader = new GLTFLoader();
const furnCache = new Map();
const loadFurn = (name) => {
  if (!furnCache.has(name)) furnCache.set(name, new Promise((ok, fail) => furnLoader.load(`${FURN}/${name}.gltf`, ok, undefined, fail)));
  return furnCache.get(name);
};

const DESK_HOLD_MS = 12000; // tempo mínimo na mesa depois de sentar para trabalhar
// Depois de concluir, continua sentado (relaxado) por 5 min: se chegar outra tarefa/mensagem nesse tempo,
// volta a trabalhar ali mesmo, sem o vai e vem entre a mesa e o lounge a cada resposta de chat.
const DESK_LINGER_MS = 5 * 60 * 1000;
const rbox = (w, h, d, m, r = 0.06) => {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
};
const CODE_COLORS = ['#f2c200', '#9fd4b5', '#e8e6df', '#8fb3ff', '#f08a5d'];

// O que fazer quando está livre: cada atividade tem vagas (posição + para onde olha) e um peso no sorteio.
// pair = só acontece em dupla (sinuca e pingue-pongue); ms = quanto dura (sem ms = até ser chamado).
const ACTIVITIES = [
  { id: 'phone', weight: 3, seated: true, spots: [
    { x: -11.16, z: 12.65, ry: Math.PI }, { x: -9.84, z: 12.65, ry: Math.PI },
    { x: -9.84, z: 8.35, ry: 0 }, { x: -11.16, z: 8.35, ry: 0 }] },
  { id: 'game', weight: 2, seated: true, spots: [{ x: -18.75, z: 9.84, ry: -Math.PI / 2 }, { x: -18.75, z: 11.16, ry: -Math.PI / 2 }] },
  { id: 'coffee', weight: 2, seated: false, ms: 2 * 60 * 1000, spots: [{ x: -19.35, z: 2.3, ry: -Math.PI / 2 }, { x: -19.35, z: 3.7, ry: -Math.PI / 2 }] },
  { id: 'pool', weight: 3, seated: false, pair: true, spots: [{ x: 9.35, z: -11, ry: Math.PI / 2 }, { x: 13.65, z: -11.5, ry: -Math.PI / 2 }] },
  { id: 'pingpong', weight: 3, seated: false, pair: true, spots: [{ x: 15.55, z: -5, ry: Math.PI / 2 }, { x: 19.45, z: -5, ry: -Math.PI / 2 }] },
];

// Livre no computador da própria mesa (navegando): 3 a 6 min, depois escolhe outra coisa.
const DESK_ACT = { id: 'desk', weight: 3, seated: true, ms: 3 * 60 * 1000, jitter: 1 };
const AISLE_Z = 5;
const DESK_COLS = 4;
const STATUS_COLOR = {
  idle: '#8f8d86', thinking: '#8f7fd0', working: '#f2c200', meeting: '#f2c200', presenting: '#4fbf8a',
  online: '#4fbf8a', away: '#8f8d86',
};
const STATUS_LABEL = {
  idle: 'livre', thinking: 'pensando', working: 'trabalhando', meeting: 'em reunião', presenting: 'reportando',
  online: 'online', away: 'ausente',
};

const MEETING_TABLES = [
  new THREE.Vector3(8, 0, 3.5), new THREE.Vector3(15, 0, 3.5), new THREE.Vector3(11.5, 0, 10),
  new THREE.Vector3(18, 0, 10),
];
const LOUNGE = { x0: -19, x1: -5, z0: 8, z1: 13 };
const PLANTS = [[-21.5, -14.5], [-2, -14.5], [21.5, -14.5], [21.5, 14.5], [-21.5, 14.5], [2, 14], [-3.5, 8.5], [21.5, 1.5], [8.6, -14.3], [-21.6, 6.6]];
// Meu personagem: velocidade (andando / correndo com Shift), raio do corpo e distância para abrir a conversa.
const WALK_SPEED = 4.4, RUN_SPEED = 7.5, BODY_R = 0.32, TALK_IN = 2.4, TALK_OUT = 3.2;
const FLOOR = { x0: -22.5, x1: 22.5, z0: -15.5, z1: 15.5 };
const _v = new THREE.Vector3();
const STAGE = new THREE.Vector3(5, 0, -6.5);

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });
const box = (w, h, d, m) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
};

export class Office {
  constructor(container) {
    this.container = container;
    this.avatars = new Map();
    this.clickHandlers = [];
    this.selected = null;

    const w = container.clientWidth, h = container.clientHeight;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#cfd1cd');
    this.scene.fog = new THREE.Fog('#cfd1cd', 70, 150);

    // Em telas estreitas (celular), abre mais o enquadramento para o escritório caber na largura.
    const aspect = w / h, frustum = aspect < 1.3 ? (34 * 1.3) / aspect : 34;
    this.camera = new THREE.OrthographicCamera(-frustum * aspect / 2, frustum * aspect / 2, frustum / 2, -frustum / 2, 0.1, 500);
    this.camera.position.set(34, 34, 34);
    this.camera.lookAt(0, 0, 0);
    this.frustum = frustum;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.setSize(w, h);
    this.labels.domElement.className = 'labels-layer';
    container.appendChild(this.labels.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minZoom = 0.6;
    this.controls.maxZoom = 3.5;
    this.controls.maxPolarAngle = Math.PI / 2.6;
    this.controls.minPolarAngle = Math.PI / 6;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0, 0);

    this.buildLights();
    this.buildWorld();
    this.decorate();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    // Meu personagem (andar pelo escritório) e conversa por proximidade
    this.player = { active: false, keys: new Set(), target: null, joy: null, near: null, checkAt: 0 };
    this.proxHandlers = [];
    this.frameHandlers = [];
    this.walkHandlers = [];
    this.inputEnabled = true;
    this.initPlayer();
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      this.pick(e);
    });

    window.addEventListener('resize', () => this.resize());
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---------------- cenário ----------------
  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9c998f', 1.25));
    const sun = new THREE.DirectionalLight('#fff6e6', 1.7);
    sun.position.set(25, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 120 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    // Luz de preenchimento fria do lado oposto: volume nos objetos sem estourar o branco.
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.35);
    fill.position.set(-30, 20, -10);
    this.scene.add(fill);
  }

  buildWorld() {
    const s = this.scene;
    // Grama e rua
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mat('#c6c8c3'));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.06; grass.receiveShadow = true;
    s.add(grass);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(220, 7), mat('#55554f'));
    road.rotation.x = -Math.PI / 2; road.position.set(0, -0.04, -24);
    s.add(road);
    for (let x = -100; x < 100; x += 6) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.25), mat('#f4f4f4'));
      stripe.rotation.x = -Math.PI / 2; stripe.position.set(x, -0.03, -24);
      s.add(stripe);
    }
    const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(220, 3), mat('#bdb9ae'));
    sidewalk.rotation.x = -Math.PI / 2; sidewalk.position.set(0, -0.035, -19);
    s.add(sidewalk);

    // Piso do escritório
    const floor = box(46, 0.2, 32, mat('#eef0ed'));
    floor.position.y = -0.1;
    s.add(floor);
    const wood = box(18, 0.04, 15, mat('#c9a27a', { roughness: 0.7 }));
    wood.position.set(12.5, 0.02, 6.5);
    s.add(wood);
    const rug = box(16, 0.03, 7, mat('#dfe1dd'));
    rug.position.set(-12, 0.02, 10.5);
    s.add(rug);

    // Paredes de vidro (fundo/esquerda altas, frente/direita baixas para enxergar)
    const glass = new THREE.MeshStandardMaterial({ color: '#d6dbd8', transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.2 });
    const frame = mat('#1c1d1c');
    const wall = (w, h, x, z, rotY) => {
      const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), glass);
      g.position.set(x, h / 2, z); g.rotation.y = rotY;
      s.add(g);
      const top = box(w, 0.12, 0.14, frame); top.position.set(x, h, z); top.rotation.y = rotY; s.add(top);
      const n = Math.floor(w / 3);
      for (let i = 0; i <= n; i++) {
        const p = box(0.12, h, 0.12, frame);
        const off = -w / 2 + (i * w) / n;
        p.position.set(x + Math.cos(rotY) * off, h / 2, z - Math.sin(rotY) * off);
        s.add(p);
      }
    };
    wall(46, 3.4, 0, -16, 0);
    wall(32, 3.4, -23, 0, Math.PI / 2);
    wall(46, 1.1, 0, 16, 0);
    wall(32, 1.1, 23, 0, Math.PI / 2);

    // Árvores lá fora
    for (const [x, z] of [[-30, -20], [-15, -29], [8, -29], [26, -20], [34, 2], [-32, 6], [30, 22], [-26, 24], [0, 27]]) this.tree(x, z);

    // Palco central com a marca da empresa
    const slats = new THREE.Group();
    for (let i = 0; i < 18; i++) {
      const b = box(0.36, 4.2, 0.4, mat(i % 2 ? '#1a5c3f' : '#1f6b4a'));
      b.position.set(-3.2 + i * 0.38, 2.1, 0);
      slats.add(b);
    }
    slats.position.set(STAGE.x, 0, STAGE.z - 2.2);
    s.add(slats);
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 1024; this.signCanvas.height = 256;
    this.signTex = new THREE.CanvasTexture(this.signCanvas);
    this.signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: this.signTex, transparent: true }));
    sign.position.set(STAGE.x, 2.8, STAGE.z - 1.95);
    s.add(sign);
    const stageDesk = box(3, 1, 1, mat('#f5f5f0'));
    stageDesk.position.set(STAGE.x, 0.5, STAGE.z);
    s.add(stageDesk);

    // TV com o kanban
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 1024; this.boardCanvas.height = 576;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const tvFrame = box(8.6, 4.9, 0.4, mat('#1c1d1c'));
    tvFrame.position.set(15, 2.75, -15.6);
    s.add(tvFrame);
    const tv = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.5), new THREE.MeshBasicMaterial({ map: this.boardTex }));
    tv.position.set(15, 2.75, -15.38);
    s.add(tv);
    this.updateBoard([]);

    // Sala de reunião: mesas redondas
    for (const t of MEETING_TABLES) {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.08, 28), mat('#ffffff'));
      top.position.set(t.x, 1.05, t.z); top.castShadow = true;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 1.05, 12), mat('#555'));
      leg.position.set(t.x, 0.52, t.z);
      s.add(top, leg);
    }

    // Lounge: sofás de bate-papo (celular), mesinha e tapete
    const coffee = rbox(2.2, 0.38, 1.1, mat('#d9b48f', { roughness: 0.6 }), 0.08);
    coffee.position.set(-10.5, 0.19, 10.5);
    s.add(coffee);
    // móveis simples (ficam até os modelos KayKit carregarem; aí somem)
    this.basicFurniture = [this.sofa(-10.5, 12.8, 0), this.sofa(-10.5, 8.2, Math.PI), coffee, this.sofa(-18.6, 10.5, Math.PI / 2)];
    // Canto do videogame: TV na parede esquerda, console e sofá de frente
    const rack = rbox(0.6, 0.5, 3.2, mat('#2b2c2a'), 0.05); rack.position.set(-22.3, 0.25, 10.5); s.add(rack);
    const tvBox = rbox(0.16, 1.9, 3.2, mat('#111214', { roughness: 0.3 }), 0.04); tvBox.position.set(-22.4, 1.75, 10.5); s.add(tvBox);
    this.gameCanvas = document.createElement('canvas'); this.gameCanvas.width = 320; this.gameCanvas.height = 180;
    this.gameTex = new THREE.CanvasTexture(this.gameCanvas); this.gameTex.colorSpace = THREE.SRGBColorSpace;
    const gameScreen = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.7), new THREE.MeshBasicMaterial({ map: this.gameTex, toneMapped: false }));
    gameScreen.rotation.y = Math.PI / 2; gameScreen.position.set(-22.3, 1.75, 10.5); s.add(gameScreen);
    const consoleBox = rbox(0.4, 0.12, 0.5, mat('#f4f4f2'), 0.03); consoleBox.position.set(-22.1, 0.56, 9.6); s.add(consoleBox);
    this.drawGame(0, false);
    // Café: balcão, máquina, xícaras
    const counter = rbox(4, 1.1, 1, mat('#1c1d1c', { roughness: 0.5 }), 0.05);
    counter.position.set(-20.5, 0.55, 3); counter.rotation.y = Math.PI / 2;
    s.add(counter);
    const machine = rbox(0.6, 0.7, 0.5, mat('#b9bcbf', { metalness: 0.6, roughness: 0.3 }), 0.06); machine.position.set(-20.6, 1.45, 2.0); s.add(machine);
    for (let i = 0; i < 3; i++) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 12), mat('#ffffff')); cup.position.set(-20.4, 1.17, 3.3 + i * 0.3); s.add(cup); }
    // Sala de jogos: sinuca e pingue-pongue
    this.poolTable(11.5, -11);
    this.pingPongTable(17.5, -5);
    for (const [x, z] of PLANTS) this.plant(x, z);

    this.buildFacade();

    this.desksGroup = new THREE.Group();
    s.add(this.desksGroup);
    this.setCompany('IAORG');
  }

  poolTable(x, z) {
    const g = new THREE.Group();
    const wood = mat('#5a3a22', { roughness: 0.5 });
    const felt = mat('#1f6b4a', { roughness: 0.95 });
    const top = rbox(3.4, 0.22, 1.9, wood, 0.08); top.position.y = 0.92;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.04, 1.5), felt); cloth.position.y = 1.04; cloth.receiveShadow = true;
    g.add(top, cloth);
    for (const [lx, lz] of [[-1.45, -0.75], [1.45, -0.75], [-1.45, 0.75], [1.45, 0.75]]) {
      const leg = rbox(0.22, 0.85, 0.22, wood, 0.05); leg.position.set(lx, 0.42, lz); g.add(leg);
    }
    const ballColors = ['#ffffff', '#f2c200', '#2e5e8c', '#b8401c', '#5b4b8a', '#e07a2f', '#1f6b4a', '#8a1c1c', '#111111'];
    this.poolBalls = ballColors.map((c, i) => {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), mat(c, { roughness: 0.25 }));
      b.position.set(i === 0 ? -0.8 : 0.5 + (i % 3) * 0.13, 1.13, i === 0 ? 0 : (Math.floor(i / 3) - 1) * 0.15);
      b.castShadow = true;
      g.add(b);
      return b;
    });
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.pool = { g, x, z };
  }

  pingPongTable(x, z) {
    const g = new THREE.Group();
    const top = rbox(2.8, 0.06, 1.5, mat('#2e5e8c', { roughness: 0.6 }), 0.02); top.position.y = 0.78;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.03), mat('#ffffff')); line.rotation.x = -Math.PI / 2; line.position.y = 0.815;
    const net = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.16), mat('#f4f4f2', { side: THREE.DoubleSide }));
    const netMesh = rbox(0.03, 0.16, 1.6, mat('#e8e6df'), 0.01); netMesh.position.y = 0.89;
    g.add(top, line, netMesh);
    for (const [lx, lz] of [[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.76, 8), mat('#3a3b38')); leg.position.set(lx, 0.38, lz); g.add(leg);
    }
    void net;
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.ppBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.2 }));
    this.ppBall.visible = false; this.ppBall.castShadow = true;
    this.scene.add(this.ppBall);
    this.pp = { x, z };
  }

  // Fachada: placa luminosa no alto da parede de vidro, marquise de entrada, totem na calçada,
  // postes, bancos, faixa de pedestres e carros passando na rua.
  buildFacade() {
    const s = this.scene;
    const graphite = mat('#1c1d1c', { roughness: 0.45 });
    // placa luminosa sobre a parede do fundo (virada para dentro, que é o lado que a câmera vê)
    this.facadeCanvas = document.createElement('canvas'); this.facadeCanvas.width = 1024; this.facadeCanvas.height = 192;
    this.facadeTex = new THREE.CanvasTexture(this.facadeCanvas); this.facadeTex.colorSpace = THREE.SRGBColorSpace;
    const backing = rbox(13, 2.0, 0.3, graphite, 0.08); backing.position.set(-10, 4.55, -16.15); s.add(backing);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(12.4, 1.75), new THREE.MeshBasicMaterial({ map: this.facadeTex, toneMapped: false }));
    face.position.set(-10, 4.55, -15.99); s.add(face);
    for (const px of [-15.5, -4.5]) { const post = rbox(0.14, 1.3, 0.14, graphite, 0.04); post.position.set(px, 3.55, -16.15); s.add(post); }
    // marquise de entrada no meio da fachada, com porta de vidro e capacho
    const canopy = rbox(6.5, 0.22, 3, mat('#e8e6df', { roughness: 0.5 }), 0.08); canopy.position.set(0, 3.7, -17.3); s.add(canopy);
    for (const px of [-3, 3]) { const p = rbox(0.18, 3.6, 0.18, graphite, 0.05); p.position.set(px, 1.8, -18.6); s.add(p); }
    const door = rbox(2.4, 2.6, 0.12, new THREE.MeshStandardMaterial({ color: '#9fb4ad', transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.3 }), 0.03); door.position.set(0, 1.3, -16.05); s.add(door);
    const doorFrame = rbox(2.6, 0.14, 0.16, graphite, 0.03); doorFrame.position.set(0, 2.66, -16.05); s.add(doorFrame);
    const mat1 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), mat('#f2c200')); mat1.rotation.x = -Math.PI / 2; mat1.position.set(0, -0.03, -17.4); s.add(mat1);
    // totem na calçada, virado para a câmera
    this.totemCanvas = document.createElement('canvas'); this.totemCanvas.width = 256; this.totemCanvas.height = 640;
    this.totemTex = new THREE.CanvasTexture(this.totemCanvas); this.totemTex.colorSpace = THREE.SRGBColorSpace;
    const totem = new THREE.Group();
    const tBody = rbox(1.5, 4.2, 0.5, graphite, 0.1); tBody.position.y = 2.1;
    const tFace = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 3.9), new THREE.MeshBasicMaterial({ map: this.totemTex, toneMapped: false })); tFace.position.set(0, 2.15, 0.26);
    totem.add(tBody, tFace);
    totem.position.set(12, 0, -18.4); totem.rotation.y = Math.PI / 4;
    s.add(totem);
    // postes de luz, bancos e lixeiras na calçada
    for (const px of [-20, -8, 8, 20]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 10), graphite); pole.position.set(px, 2.1, -20.4); pole.castShadow = true;
      const arm = rbox(0.9, 0.08, 0.12, graphite, 0.03); arm.position.set(px + 0.4, 4.15, -20.4);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.22), new THREE.MeshBasicMaterial({ color: '#fff3c4' })); lamp.position.set(px + 0.7, 4.08, -20.4);
      s.add(pole, arm, lamp);
    }
    for (const bx of [-14, 5.5]) {
      const seat = rbox(1.8, 0.1, 0.5, mat('#9c6b45', { roughness: 0.7 }), 0.03); seat.position.set(bx, 0.48, -18.2);
      const l1 = rbox(0.08, 0.45, 0.45, graphite, 0.02); l1.position.set(bx - 0.75, 0.24, -18.2);
      const l2 = l1.clone(); l2.position.x = bx + 0.75;
      s.add(seat, l1, l2);
    }
    // faixa de pedestres na frente da entrada
    for (let i = 0; i < 6; i++) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 6.4), mat('#f4f4f4')); stripe.rotation.x = -Math.PI / 2; stripe.position.set(-2.5 + i, -0.025, -24); s.add(stripe);
    }
    // carros passando
    this.cars = [];
    const carColors = ['#b8401c', '#2e5e8c', '#f2c200', '#e8e6df', '#1f6b4a'];
    for (let i = 0; i < 4; i++) {
      const c = this.car(carColors[i % carColors.length]);
      const lane = i % 2 ? -22.6 : -25.4;
      c.position.set(-60 + i * 32, 0, lane);
      c.rotation.y = i % 2 ? -Math.PI / 2 : Math.PI / 2;
      c.userData = { speed: (i % 2 ? -1 : 1) * (5 + (i % 3) * 1.6) };
      s.add(c);
      this.cars.push(c);
    }
  }

  car(color) {
    const g = new THREE.Group();
    const body = rbox(1.9, 0.7, 4, mat(color, { roughness: 0.35, metalness: 0.3 }), 0.25); body.position.y = 0.65;
    const cabin = rbox(1.6, 0.6, 2.1, mat('#222629', { roughness: 0.15, metalness: 0.4 }), 0.2); cabin.position.set(0, 1.2, -0.2);
    g.add(body, cabin);
    for (const [wx, wz] of [[-0.9, 1.3], [0.9, 1.3], [-0.9, -1.3], [0.9, -1.3]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), mat('#151515'));
      w.rotation.z = Math.PI / 2; w.position.set(wx, 0.34, wz); g.add(w);
    }
    const lights = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: '#fff3c4' })); lights.position.set(0, 0.75, 2.01);
    g.add(lights);
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    return g;
  }

  // Tela do videogame: "jogo" colorido animado quando alguém está jogando.
  drawGame(now, on) {
    const g = this.gameCanvas.getContext('2d'), W = 320, H = 180;
    if (!on) { g.fillStyle = '#0c0d0f'; g.fillRect(0, 0, W, H); g.fillStyle = '#1d2024'; g.fillRect(W / 2 - 10, H / 2 - 2, 20, 4); this.gameTex.needsUpdate = true; return; }
    const t = now / 1000;
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#2e5e8c'); sky.addColorStop(1, '#8fb3ff');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1f6b4a';
    for (let i = 0; i < 6; i++) { const x = ((i * 70 - t * 60) % (W + 70) + W + 70) % (W + 70) - 70; g.fillRect(x, 120 - (i % 3) * 18, 50, 80); }
    g.fillStyle = '#c9a27a'; g.fillRect(0, 150, W, 30);
    const jump = Math.abs(Math.sin(t * 3)) * 34;
    g.fillStyle = '#f2c200'; g.fillRect(70, 126 - jump, 18, 24);
    g.fillStyle = '#b8401c'; g.fillRect(((W - t * 110) % W + W) % W, 136, 14, 14);
    g.fillStyle = '#ffffff'; g.font = '700 14px Archivo, sans-serif'; g.fillText(`${String(Math.floor(t * 37) % 10000).padStart(5, '0')}`, W - 70, 22);
    this.gameTex.needsUpdate = true;
  }

  tree(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.4), mat('#7a5537'));
    trunk.position.set(x, 1.2, z); trunk.castShadow = true;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), mat('#5d7a4a', { flatShading: true }));
    crown.position.set(x, 3.6, z); crown.castShadow = true;
    this.scene.add(trunk, crown);
  }

  plant(x, z) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.6, 12), mat('#9c8f7a'));
    pot.position.set(x, 0.3, z);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), mat('#4f7a43', { flatShading: true }));
    leaves.position.set(x, 1.05, z); leaves.scale.y = 1.4; leaves.castShadow = true;
    this.scene.add(pot, leaves);
  }

  sofa(x, z, rot) {
    const g = new THREE.Group();
    const m = mat('#2b2c2a', { roughness: 0.85 });
    const cushion = mat('#3a3b38', { roughness: 0.9 });
    const seat = rbox(3, 0.42, 1.1, m, 0.12); seat.position.y = 0.3;
    const c1 = rbox(1.25, 0.16, 0.95, cushion, 0.07); c1.position.set(-0.66, 0.58, -0.02);
    const c2 = c1.clone(); c2.position.x = 0.66;
    const back = rbox(3, 0.9, 0.3, m, 0.12); back.position.set(0, 0.75, 0.45);
    const a1 = rbox(0.3, 0.7, 1.1, m, 0.12); a1.position.set(-1.4, 0.5, 0);
    const a2 = a1.clone(); a2.position.x = 1.4;
    g.add(seat, c1, c2, back, a1, a2);
    g.position.set(x, 0, z); g.rotation.y = rot;
    this.scene.add(g);
    return g;
  }

  // Lounge, canto do videogame e decoração com os móveis KayKit (os simples somem quando estes chegam).
  async decorate() {
    const place = async (name, x, z, ry = 0, { y = 0, s = KK } = {}) => {
      const g = await loadFurn(name);
      const o = g.scene.clone(true);
      o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      o.scale.setScalar(s); o.position.set(x, y, z); o.rotation.y = ry;
      this.scene.add(o);
      return o;
    };
    // os sofás antigos olham para -z na rotação 0; os KayKit olham para +z → somar meia volta
    const FLIP = Math.PI;
    try {
      await Promise.all([
        // lounge: dois sofás frente a frente, mesinha com livros, poltrona, tapete e luminárias
        place('rug_rectangle_stripes_A', -10.5, 10.5, 0, { y: 0.05, s: 1.35 }),
        place('couch_pillows', -10.5, 12.8, 0 + FLIP),
        place('couch_pillows', -10.5, 8.2, Math.PI + FLIP),
        place('table_low', -10.5, 10.5, 0),
        place('book_set', -10.1, 10.5, 0.3, { y: 0.43 }),
        place('armchair_pillows', -14.1, 10.5, Math.PI / 2),
        place('lamp_standing', -12.9, 13.1, 0),
        place('lamp_standing', -8.1, 7.9, 0),
        // canto do videogame
        place('couch', -18.6, 10.5, Math.PI / 2 + FLIP),
        place('rug_oval_A', -20.2, 10.5, Math.PI / 2, { y: 0.035 }),
        // parede do fundo: armários e estante decorados, quadros e cactos
        place('cabinet_medium_decorated', -12.2, -15.4, 0),
        place('pictureframe_large_B', -12.2, -15.86, 0, { y: 1.95 }),
        place('shelf_B_large_decorated', -6.8, -15.55, 0, { y: 0.9 }),
        place('pictureframe_large_A', -17.4, -15.86, 0, { y: 1.75 }),
        place('cabinet_small_decorated', 1.2, -15.4, 0),
        place('pictureframe_medium', 3.0, -15.86, 0, { y: 1.8 }),
        place('cactus_medium_A', -4.6, 7.3, 0),
        place('cactus_medium_B', -20.8, -0.6, 0),
        place('lamp_table', -12.8, -15.35, 0, { y: 1.62, s: 0.6 }),
      ]);
      for (const o of this.basicFurniture || []) o.visible = false;
    } catch (e) { console.warn('[escritório] móveis', e); return; }
    // novos obstáculos para quem anda pelo escritório
    this.extraObstacles = [
      { x0: -14.8, x1: -13.4, z0: 9.8, z1: 11.2 }, // poltrona
      { cx: -12.9, cz: 13.1, r: 0.4 }, { cx: -8.1, cz: 7.9, r: 0.4 }, // luminárias
      { x0: -13.1, x1: -11.3, z0: -16, z1: -14.95 }, // armário
      { x0: -2.0, x1: 2.0, z0: -16, z1: -15.1 }, // armário pequeno (folgado)
      { cx: -4.6, cz: 7.3, r: 0.45 }, { cx: -20.8, cz: -0.6, r: 0.45 }, // cactos
    ];
    this._obs = null;
  }

  deskSlot(i) {
    const col = i % DESK_COLS, row = Math.floor(i / DESK_COLS);
    const x = -19 + col * 4.4;
    const z = -12.5 + row * 3.8;
    return { desk: new THREE.Vector3(x, 0, z), seat: new THREE.Vector3(x, 0, z + 1.05), gapX: x + 2.2 };
  }

  buildDesks(n) {
    this.desksGroup.clear();
    for (const d of this.desks || []) d.tex.dispose();
    this.desks = [];
    const wood = mat('#efe9df', { roughness: 0.55 });
    const metal = mat('#3a3b38', { roughness: 0.4, metalness: 0.5 });
    const dark = mat('#1d1f22', { roughness: 0.35, metalness: 0.2 });
    const chairMat = mat('#2b2c2a', { roughness: 0.6 });
    for (let i = 0; i < n; i++) {
      const { desk, seat } = this.deskSlot(i);
      const top = rbox(2.6, 0.08, 1.2, wood, 0.04); top.position.set(desk.x, 1.0, desk.z);
      const l1 = rbox(0.07, 1, 1.0, metal, 0.03); l1.position.set(desk.x - 1.15, 0.5, desk.z);
      const l2 = l1.clone(); l2.position.x = desk.x + 1.15;
      const monitor = rbox(1.18, 0.7, 0.06, dark, 0.03); monitor.position.set(desk.x, 1.5, desk.z - 0.35);
      const stand = rbox(0.08, 0.38, 0.08, metal, 0.03); stand.position.set(desk.x, 1.22, desk.z - 0.38);
      const foot = rbox(0.4, 0.03, 0.25, metal, 0.015); foot.position.set(desk.x, 1.05, desk.z - 0.38);
      const keyboard = rbox(0.7, 0.03, 0.22, dark, 0.012); keyboard.position.set(desk.x, 1.055, desk.z + 0.12);
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.16, 14), mat(['#f2c200', '#1f6b4a', '#b8401c', '#ffffff'][i % 4]));
      mug.position.set(desk.x + 0.85, 1.12, desk.z + 0.1); mug.castShadow = true;

      // Tela: canvas próprio, mostra o trabalho (código, plano, progresso) enquanto o agente executa.
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 144;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.6), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      screen.position.set(desk.x, 1.5, desk.z - 0.315);
      // brilho da tela sobre a mesa (aparece quando liga)
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ color: '#f2c200', transparent: true, opacity: 0, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(desk.x, 1.045, desk.z - 0.05);

      // Cadeira giratória (grupo que vira quando a pessoa senta)
      const chair = new THREE.Group();
      const seatM = rbox(0.78, 0.12, 0.74, chairMat, 0.05); seatM.position.y = 0.58;
      const back = rbox(0.74, 0.78, 0.1, chairMat, 0.05); back.position.set(0, 1.02, 0.36);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8), metal); post.position.y = 0.32;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 5), metal); base.position.y = 0.08;
      chair.add(seatM, back, post, base);
      chair.position.set(seat.x, 0, seat.z + 0.05);
      chair.traverse((m) => { if (m.isMesh) m.castShadow = true; });

      this.desksGroup.add(top, l1, l2, monitor, stand, foot, keyboard, mug, screen, glow, chair);
      const d = { canvas, ctx: canvas.getContext('2d'), tex, screen, glow, chair, mode: null, lines: [], scroll: 0, last: 0, on: 0 };
      this.desks.push(d);
      this.drawScreen(d, 'off', 0);
    }
  }

  // Desenha a tela do monitor: desligada, "pensando" ou trabalhando (código rolando + plano/progresso).
  drawScreen(d, mode, now, work) {
    const g = d.ctx, W = 256, H = 144;
    g.fillStyle = mode === 'off' ? '#15181b' : '#101317';
    g.fillRect(0, 0, W, H);
    if (mode === 'off') {
      g.fillStyle = '#23282d';
      g.fillRect(W / 2 - 14, H / 2 - 2, 28, 4);
    } else if (mode === 'think') {
      g.fillStyle = '#8f7fd0';
      g.font = '600 15px Archivo, sans-serif';
      g.fillText('pensando', 16, 30);
      for (let i = 0; i < 3; i++) {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(now / 260 - i * 0.7));
        g.globalAlpha = a; g.beginPath(); g.arc(30 + i * 22, 72, 7, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    } else if (mode === 'browse') {
      // navegando: barra de abas, uma "página" com título, imagem e texto que rola devagar; troca de aba de vez em quando
      const tabs = ['notícias', 'documentação', 'vídeo', 'e-mail', 'fórum'];
      const tab = Math.floor(now / 9000 + (d.seed ||= Math.random() * 50)) % tabs.length;
      g.fillStyle = '#e8e6df'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#cfd1cd'; g.fillRect(0, 0, W, 18);
      tabs.slice(0, 3).forEach((t, i) => { g.fillStyle = i === tab % 3 ? '#e8e6df' : '#bfc1bd'; g.fillRect(4 + i * 62, 3, 58, 15); });
      g.fillStyle = '#3b3c39'; g.font = '600 9px Archivo, sans-serif'; g.fillText(tabs[tab], 10, 14);
      const scroll = (now / 60) % 160;
      g.save(); g.beginPath(); g.rect(0, 18, W, H - 18); g.clip(); g.translate(0, -scroll);
      for (let blk = 0; blk < 3; blk++) {
        const y0 = 26 + blk * 80;
        g.fillStyle = '#1c1d1c'; g.fillRect(14, y0, 120 + ((blk * 37) % 60), 7);
        if (tab === 2 || blk === 1) { g.fillStyle = ['#2e5e8c', '#1f6b4a', '#b8401c'][blk]; g.fillRect(14, y0 + 14, 96, 50); g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.moveTo(56, y0 + 30); g.lineTo(56, y0 + 48); g.lineTo(72, y0 + 39); g.fill(); }
        g.fillStyle = '#8f8d86';
        for (let l = 0; l < 6; l++) g.fillRect(tab === 2 || blk === 1 ? 118 : 14, y0 + 16 + l * 9, (tab === 2 || blk === 1 ? 110 : 220) - ((l * 23 + blk * 11) % 50), 4);
      }
      g.restore();
      // cursor do mouse
      const mx = 150 + Math.sin(now / 900) * 40, my = 70 + Math.cos(now / 1300) * 30;
      g.fillStyle = '#ffffff'; g.strokeStyle = '#1c1d1c'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(mx, my + 11); g.lineTo(mx + 3, my + 8); g.lineTo(mx + 7, my + 9); g.closePath(); g.fill(); g.stroke();
    } else {
      // linhas de "código" que crescem e rolam
      if (!d.lines.length || now - d.last > 140) {
        d.last = now;
        d.lines.push({ indent: (Math.random() * 4) | 0, segs: Array.from({ length: 1 + ((Math.random() * 3) | 0) }, () => ({ w: 12 + Math.random() * 46, c: CODE_COLORS[(Math.random() * CODE_COLORS.length) | 0] })) });
        if (d.lines.length > 9) d.lines.shift();
      }
      g.fillStyle = '#1b2026'; g.fillRect(0, 0, W, 16);
      g.fillStyle = '#f2c200'; g.font = '700 11px Archivo, sans-serif';
      g.fillText((work?.label || 'trabalhando').slice(0, 34), 8, 12);
      d.lines.forEach((l, i) => {
        let x = 10 + l.indent * 12;
        const y = 24 + i * 11;
        for (const s of l.segs) { g.fillStyle = s.c; g.globalAlpha = 0.85; g.fillRect(x, y, s.w, 5); x += s.w + 6; }
      });
      g.globalAlpha = 1;
      // cursor piscando
      if (Math.floor(now / 450) % 2) { g.fillStyle = '#ffffff'; g.fillRect(10 + (d.lines.at(-1)?.indent || 0) * 12, 24 + (d.lines.length - 1) * 11 + 7, 6, 2); }
      // barra de progresso (passos do plano concluídos)
      if (work?.progress != null) {
        g.fillStyle = '#262c33'; g.fillRect(8, H - 12, W - 16, 5);
        g.fillStyle = '#4fbf8a'; g.fillRect(8, H - 12, (W - 16) * Math.max(0.04, work.progress), 5);
      }
    }
    d.tex.needsUpdate = true;
  }

  /** Trabalho em andamento na oficina: o agente fica sentado trabalhando enquanto o job roda. */
  setWork(id, work) {
    const av = this.avatars.get(id);
    if (!av) return;
    const was = !!av.work?.active;
    av.work = work?.active ? work : null;
    this.paintDot(av);
    if (was !== !!av.work) this.route(av);
  }

  paintDot(av) {
    const s = this.effective(av);
    av.dotEl.style.background = STATUS_COLOR[s] || STATUS_COLOR.idle;
    av.tagEl.title = av.work?.active ? `na oficina: ${av.work.label || 'trabalhando'}` : STATUS_LABEL[s] || s;
    av.label.element.classList.toggle('working', s === 'working' || s === 'thinking');
  }

  // Placa do palco: logo (se houver) + nome da empresa.
  setCompany(name, logoUrl) {
    const draw = (img) => {
      const c = this.signCanvas, g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      let x = 20;
      if (img) {
        const h = 200, w = Math.min(320, (img.width / img.height) * h);
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.fillRect(x, 28, w + 20, h);
        g.drawImage(img, x + 10, 28 + (h - (w * img.height) / img.width) / 2, w, (w * img.height) / img.width);
        x += w + 50;
      }
      const label = String(name || '').toUpperCase();
      const room = c.width - x - 20;
      g.fillStyle = '#ffffff';
      g.textAlign = img ? 'left' : 'center'; g.textBaseline = 'middle';
      let size = 150;
      const face = (s) => `800 ${s}px "Barlow Condensed", Archivo, sans-serif`;
      g.font = face(size);
      while (g.measureText(label).width > room && size > 36) { size -= 8; g.font = face(size); }
      g.fillText(label, img ? x : c.width / 2, c.height / 2);
      this.signTex.needsUpdate = true;
      this.drawFacade(label, img, face);
    };
    // Espera as fontes da marca para não desenhar a placa com a fonte reserva.
    document.fonts.ready.then(() => {
      if (!logoUrl) return draw(null);
      const img = new Image();
      img.onload = () => draw(img);
      img.onerror = () => draw(null);
      img.src = logoUrl;
    });
  }

  // Placa luminosa da fachada (grafite com faixa amarela) e totem da calçada.
  drawFacade(label, img, face) {
    if (!this.facadeCanvas) return;
    const c = this.facadeCanvas, g = c.getContext('2d');
    g.fillStyle = '#1c1d1c'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#f2c200'; g.fillRect(0, c.height - 14, c.width, 14);
    let x = 36;
    if (img) {
      const h = 132, w = Math.min(220, (img.width / img.height) * h);
      g.fillStyle = '#ffffff'; g.fillRect(x, 16, w + 16, h + 8);
      g.drawImage(img, x + 8, 20 + (h - (w * img.height) / img.width) / 2, w, (w * img.height) / img.width);
      x += w + 46;
    }
    let size = 116;
    g.font = face(size);
    while (g.measureText(label).width > c.width - x - 36 && size > 30) { size -= 6; g.font = face(size); }
    g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = img ? 'left' : 'center';
    g.shadowColor = 'rgba(255,240,190,0.55)'; g.shadowBlur = 18;
    g.fillText(label, img ? x : c.width / 2, (c.height - 14) / 2 + 4);
    g.shadowBlur = 0;
    this.facadeTex.needsUpdate = true;

    const t = this.totemCanvas, tg = t.getContext('2d');
    tg.fillStyle = '#1c1d1c'; tg.fillRect(0, 0, t.width, t.height);
    tg.fillStyle = '#f2c200'; tg.fillRect(0, 0, t.width, 12);
    if (img) {
      const w = 190, h = Math.min(190, (img.height / img.width) * w);
      tg.fillStyle = '#ffffff'; tg.fillRect((t.width - w) / 2 - 8, 44, w + 16, h + 16);
      tg.drawImage(img, (t.width - w) / 2, 52, w, h);
    }
    tg.save();
    tg.translate(t.width / 2, img ? 420 : t.height / 2);
    tg.rotate(-Math.PI / 2);
    let ts = 84; tg.font = face(ts);
    while (tg.measureText(label).width > (img ? 330 : 560) && ts > 26) { ts -= 4; tg.font = face(ts); }
    tg.fillStyle = '#ffffff'; tg.textAlign = 'center'; tg.textBaseline = 'middle';
    tg.fillText(label, 0, 0);
    tg.restore();
    tg.fillStyle = '#f2c200'; tg.font = '700 22px Archivo, sans-serif'; tg.textAlign = 'center';
    tg.fillText('ESCRITÓRIO', t.width / 2, t.height - 30);
    this.totemTex.needsUpdate = true;
  }

  updateBoard(tasks) {
    const c = this.boardCanvas, g = c.getContext('2d');
    g.fillStyle = '#1c1d1c'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffffff'; g.font = '700 40px "Barlow Condensed", Archivo, sans-serif'; g.textAlign = 'left';
    g.fillText('Quadro de tarefas', 30, 52);
    const cols = [
      ['A fazer', (t) => t.status === 'todo' || t.status === 'blocked', '#cbc8bf'],
      ['Fazendo', (t) => t.status === 'doing' || t.status === 'review', '#f2c200'],
      ['Concluído', (t) => t.status === 'done', '#4fbf8a'],
    ];
    cols.forEach(([title, fn, color], i) => {
      const x = 30 + i * 330, list = tasks.filter(fn);
      g.fillStyle = color; g.font = '700 30px "Barlow Condensed", Archivo, sans-serif';
      g.fillText(`${title} (${list.length})`, x, 110);
      g.font = '500 21px Archivo, sans-serif';
      list.slice(-8).reverse().forEach((t, j) => {
        g.fillStyle = '#2b2c2a'; g.fillRect(x, 130 + j * 52, 310, 44);
        g.fillStyle = color; g.fillRect(x, 130 + j * 52, 6, 44);
        g.fillStyle = '#f7f6f2';
        g.fillText(`${t.id} ${t.title}`.slice(0, 26), x + 16, 160 + j * 52);
      });
    });
    this.boardTex.needsUpdate = true;
  }

  // ---------------- avatares ----------------
  syncAgents(agents, meId) {
    this.meId = meId;
    this._obs = null;
    const ids = new Set(agents.map((a) => a.id));
    for (const [id, av] of this.avatars) {
      if (!ids.has(id)) { this.releaseActivity(av); this.scene.remove(av.group); av.label.element.remove(); av.model?.dispose(); av.modelToken = -1; this.avatars.delete(id); }
    }
    this.buildDesks(agents.length);
    agents.forEach((a, i) => {
      let av = this.avatars.get(a.id);
      if (!av) av = this.createAvatar(a);
      av.agent = a;
      av.deskIndex = i;
      av.human = a.kind === 'human';
      // personagem 3D: carrega (ou recarrega quando a aparência ou a cor mudam)
      const lookKey = JSON.stringify([a.look || null, a.color]);
      if (av.lookKey !== lookKey) { av.lookKey = lookKey; this.loadModel(av, a); }
      av.nameEl.textContent = `${a.name} — ${a.role}`;
      av.shirt.color.set(a.color);
      const el = av.label.element;
      el.classList.toggle('human', av.human);
      el.classList.toggle('me', a.id === meId);
      el.classList.toggle('away', av.human && !a.online);
      if (av.human) {
        // Pessoas: ficam na mesa; cinza e translúcidas quando estão offline.
        this.ghost(av, !a.online);
        av.status = null;
        this.setAgentState(a.id, { status: a.online ? 'online' : 'away' });
      } else if (a.runtime) this.setAgentState(a.id, a.runtime);
    });
  }

  createAvatar(a) {
    const group = new THREE.Group();
    const skin = mat(['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'][hash(a.id) % 5]);
    const shirt = mat(a.color);
    const pants = mat('#3b3c39');
    const hair = mat(['#2b1d14', '#4a3123', '#d6b370', '#1a1a1a', '#8a3b12'][hash(a.id + 'h') % 5]);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 10), shirt);
    body.position.y = 1.15; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), skin);
    head.position.y = 1.85; head.castShadow = true;
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.29, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    hairMesh.position.y = 1.88;
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 3, 8), pants);
    legL.geometry.translate(0, -0.3, 0);
    legL.position.set(-0.13, 0.75, 0); legL.castShadow = true;
    const legR = legL.clone(); legR.position.x = 0.13;
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.45, 3, 8), shirt);
    armL.geometry.translate(0, -0.25, 0);
    armL.position.set(-0.4, 1.45, 0);
    const armR = armL.clone(); armR.position.x = 0.4;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 32), new THREE.MeshBasicMaterial({ color: '#f2c200', transparent: true, opacity: 0.95 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
    // Aura de trabalho: anel que pulsa no chão enquanto o agente executa uma tarefa.
    const aura = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 40), new THREE.MeshBasicMaterial({ color: '#f2c200', transparent: true, opacity: 0, depthWrite: false }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = 0.025;
    // Sombra de contato macia (ancora o personagem no chão)
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02;

    // Objetos na mão (aparecem conforme a atividade)
    const props = {
      phone: rbox(0.09, 0.16, 0.02, mat('#16181b', { roughness: 0.3 }), 0.01),
      controller: rbox(0.24, 0.05, 0.12, mat('#2b2c2a'), 0.025),
      mug: new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.15, 14), mat(['#f2c200', '#ffffff', '#1f6b4a', '#b8401c'][hash(a.id) % 4])),
      paddle: new THREE.Group(),
      cue: new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 1.55, 8), mat('#c9a27a', { roughness: 0.5 })),
    };
    const paddleHead = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16), mat('#b8401c'));
    paddleHead.rotation.x = Math.PI / 2; paddleHead.position.y = -0.1;
    const paddleHandle = rbox(0.035, 0.11, 0.03, mat('#7a5537'), 0.01);
    props.paddle.add(paddleHead, paddleHandle);
    const screenGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.13), new THREE.MeshBasicMaterial({ color: '#8fb3ff', toneMapped: false }));
    screenGlow.position.z = 0.011; props.phone.add(screenGlow);
    for (const k of ['phone', 'controller', 'mug', 'paddle']) { props[k].position.set(0, -0.6, 0.06); props[k].visible = false; armR.add(props[k]); }
    props.phone.rotation.x = -0.9;
    props.cue.rotation.x = Math.PI / 2 + 0.18; props.cue.position.set(0.14, 1.02, 0.55); props.cue.visible = false;

    const torso = new THREE.Group(); // tronco + cabeça + braços (inclina para a frente ao digitar)
    torso.position.y = 0.9;
    for (const m of [body, head, hairMesh, armL, armR]) { m.position.y -= 0.9; torso.add(m); }
    const rig = new THREE.Group();
    rig.add(torso, legL, legR);
    group.add(rig, ring, aura, blob, props.cue);
    for (const m of [body, head, hairMesh]) m.userData.agentId = a.id;

    // Etiqueta "Nome — Cargo" + balão de fala
    const el = document.createElement('div');
    el.className = 'agent-label';
    el.innerHTML = '<div class="bubble"></div><div class="tag"><span class="dot"></span><span class="name"></span></div>';
    el.addEventListener('click', () => this.clickHandlers.forEach((fn) => fn(a.id)));
    const label = new CSS2DObject(el);
    label.center.set(0.5, 1); // ancorado pela base: a etiqueta fica acima do ponto, não centralizada nele
    label.position.set(0, 2.45, 0);
    group.add(label);

    const start = new THREE.Vector3(LOUNGE.x0 + Math.random() * (LOUNGE.x1 - LOUNGE.x0), 0, LOUNGE.z0 + Math.random() * (LOUNGE.z1 - LOUNGE.z0));
    group.position.copy(start);
    this.scene.add(group);

    const av = {
      group, rig, torso, head, hairMesh, shirt, legL, legR, armL, armR, ring, aura, blob, label, sit: 0, props, act: null,
      nameEl: el.querySelector('.name'), dotEl: el.querySelector('.dot'), bubbleEl: el.querySelector('.bubble'), tagEl: el.querySelector('.tag'),
      path: [], status: 'idle', seated: false, idleUntil: 0, phase: Math.random() * 10, with: null, bubbleUntil: 0,
    };
    this.avatars.set(a.id, av);
    return av;
  }

  // Pessoa offline: personagem translúcido.
  ghost(av, on) {
    av.ghosted = on;
    const apply = (m) => { if (!m.material) return; m.material.transparent = on; m.material.opacity = on ? 0.45 : 1; m.material.needsUpdate = true; };
    av.rig.traverse(apply);
    av.model?.model.traverse(apply);
  }

  // Troca o boneco simples pelo personagem animado (KayKit). Enquanto carrega, o simples continua visível.
  async loadModel(av, a) {
    const token = (av.modelToken || 0) + 1;
    av.modelToken = token;
    let m;
    try { m = await buildCharacter(a.look, a.id, a.color); } catch (e) { console.warn('[escritório] personagem', a.id, e); return; }
    if (av.modelToken !== token || !this.avatars.has(a.id)) { m.dispose(); return; }
    if (av.model) { av.group.remove(av.model.root); av.model.dispose(); }
    av.model = m;
    av.group.add(m.root);
    av.rig.visible = false;
    // objetos das atividades (celular, controle, caneca, raquete) passam para a mão do personagem
    const hand = m.bones['handslot.r'];
    if (hand) {
      const inv = 1 / m.model.scale.x;
      for (const k of ['phone', 'controller', 'mug', 'paddle']) {
        const p = av.props[k];
        hand.add(p);
        p.position.set(0, 0, 0); p.rotation.set(k === 'phone' ? -0.4 : 0, 0, 0); p.scale.setScalar(inv);
      }
    }
    if (av.ghosted) this.ghost(av, true);
    m.play('Idle_A', { fade: 0 });
  }

  // Animação do personagem conforme o que ele está fazendo (por cima, pequenos ajustes de pose).
  animateModel(av, { walking, sitting, busy, eff, act, playing, run, dt, now }) {
    const m = av.model;
    let clip = 'Idle_A', speed = 1;
    if (walking) { clip = run ? 'Running_A' : 'Walking_A'; speed = run ? 1 : 1.15; }
    else if (sitting) clip = 'Sit_Chair_Idle';
    else if (act === 'coffee') clip = 'Holding_A';
    else if (act === 'pool' || act === 'pingpong') clip = playing ? 'Holding_B' : 'Idle_B';
    else if (eff === 'meeting' || eff === 'presenting') clip = 'Idle_B';
    if (!m.busyOnce()) m.play(clip, { speed });
    m.update(dt);
    // altura: encaixa o quadril no assento quando senta
    m.root.position.y = av.sit * m.sitY;
    const b = m.bones;
    if (sitting && busy && b['lowerarm.l'] && b['lowerarm.r']) {
      // digitando em rajadas, olhando a tela
      const burst = Math.sin(av.phase * 0.8) > -0.4 ? 1 : 0.15;
      b['upperarm.l'] && (b['upperarm.l'].rotation.x -= 0.55);
      b['upperarm.r'] && (b['upperarm.r'].rotation.x -= 0.55);
      b['lowerarm.l'].rotation.x -= 0.5 + Math.sin(av.phase * 22) * 0.12 * burst;
      b['lowerarm.r'].rotation.x -= 0.5 + Math.sin(av.phase * 22 + 1.7) * 0.12 * burst;
      if (eff === 'thinking' && b['lowerarm.r']) b['lowerarm.r'].rotation.x -= 0.9;
      if (b.head) b.head.rotation.y += Math.sin(av.phase * 0.7) * 0.15;
    } else if (act === 'desk' && b['lowerarm.l'] && b['lowerarm.r']) {
      // navegando: mão direita no mouse (mexe devagar), esquerda apoiada; olha a tela, às vezes recosta
      b['upperarm.l'] && (b['upperarm.l'].rotation.x -= 0.45);
      b['upperarm.r'] && (b['upperarm.r'].rotation.x -= 0.55);
      b['lowerarm.l'].rotation.x -= 0.45;
      b['lowerarm.r'].rotation.x -= 0.55 + Math.sin(av.phase * 1.7) * 0.05;
      if (b.head) { b.head.rotation.y += Math.sin(av.phase * 0.35) * 0.12; b.head.rotation.x += 0.08; }
      if (b.spine && Math.sin(av.phase * 0.08) > 0.6) b.spine.rotation.x -= 0.12; // recosta de vez em quando
    } else if (act === 'phone' || act === 'game') {
      if (b.head) b.head.rotation.x += act === 'phone' ? 0.45 : 0.15;
      for (const s of ['l', 'r']) { if (b[`upperarm.${s}`]) b[`upperarm.${s}`].rotation.x -= 0.6; if (b[`lowerarm.${s}`]) b[`lowerarm.${s}`].rotation.x -= 0.8 + (act === 'game' ? Math.sin(av.phase * 18 + (s === 'l' ? 1 : 0)) * 0.06 : 0); }
    }
    void now;
  }

  setAgentState(id, { status = 'idle', with: withId = null, bubble = '' }) {
    const av = this.avatars.get(id);
    if (!av) return;
    if (av.human && status !== 'online' && status !== 'away') status = av.status || 'away';
    const changed = av.status !== status || av.with !== withId;
    av.status = status; av.with = withId;
    this.paintDot(av);
    if (bubble) {
      av.bubbleEl.textContent = bubble;
      av.bubbleEl.classList.add('show');
      av.bubbleUntil = performance.now() + 7000;
    }
    if (changed) this.route(av);
  }

  // Status que manda no corpo: trabalho na oficina prevalece sobre o status do ciclo rápido.
  effective(av) {
    if (av.work?.active && !['meeting', 'presenting'].includes(av.status)) return 'working';
    return av.status;
  }
  wantsDesk(av) {
    const s = this.effective(av);
    return av.human || s === 'thinking' || s === 'working';
  }

  route(av) {
    if (this.player.active && av === this.meAv) return; // estou andando: quem manda é o teclado
    const now = performance.now();
    let target;
    if (this.wantsDesk(av)) {
      const slot = this.deskSlot(av.deskIndex);
      target = slot.seat.clone();
      av.facing = Math.PI; // de frente para o monitor (-z)
      av.pending = false;
      av.linger = false;
      // já estava no computador (navegando): só começa a trabalhar ali mesmo, sem levantar
      const atDesk = av.act?.id === 'desk' && !av.path.length && av.group.position.distanceTo(target) < 0.4;
      this.releaseActivity(av);
      if (atDesk) { av.goSeat = true; av.seated = true; av.hurry = false; av.holdUntil = now + DESK_HOLD_MS; return; }
      if (av.goSeat && (av.seated || av.path.length)) return; // já está indo/sentado: não refaz o caminho
      av.goSeat = true;
      av.hurry = true;
      av.holdUntil = now + DESK_HOLD_MS;
      this.setPath(av, target, slot.gapX);
      return;
    }
    // Acabou de concluir: marca a hora (só na transição, não a cada nova checagem).
    if (av.goSeat && !av.pending && !av.linger) av.lastBusyAt = now;
    if (av.goSeat && !av.human && this.effective(av) === 'idle') {
      // 1) acabou rápido demais: termina de sentar e "digita" até completar o tempo mínimo;
      if (now < (av.holdUntil || 0)) { av.pending = true; av.linger = false; return; }
      // 2) depois fica sentado, relaxado, até 5 min após concluir (reunião ou apresentação tiram ele antes).
      const stay = (av.lastBusyAt || now) + DESK_LINGER_MS;
      if (now < stay) { av.pending = false; av.linger = true; av.stayUntil = stay; return; }
    }
    av.pending = false;
    av.linger = false;
    av.hurry = false;
    av.goSeat = false;
    const st = this.effective(av);
    if (st === 'idle' && !av.human) { this.pickActivity(av); return; }
    this.releaseActivity(av);
    if (st === 'meeting' && String(av.with).startsWith('grupo:')) {
      // reunião de grupo (rotina): todos na mesma mesa, cada um numa cadeira ao redor
      const table = MEETING_TABLES[hash(av.with) % MEETING_TABLES.length];
      const ang = (hash(av.agent.id) % 8) * (Math.PI / 4);
      target = new THREE.Vector3(table.x + Math.cos(ang) * 1.7, 0, table.z + Math.sin(ang) * 1.7);
      av.facePoint = table.clone();
    } else if (st === 'meeting' && av.with) {
      const pair = [av.agent.id, av.with].sort();
      const table = MEETING_TABLES[hash(pair.join('|')) % MEETING_TABLES.length];
      const ang = (av.agent.id === pair[0] ? 0 : Math.PI) + (hash(pair.join()) % 6) * 0.5;
      target = new THREE.Vector3(table.x + Math.cos(ang) * 1.6, 0, table.z + Math.sin(ang) * 1.6);
      av.facePoint = table.clone();
    } else if (st === 'presenting') {
      target = new THREE.Vector3(STAGE.x + (Math.random() - 0.5) * 2, 0, STAGE.z + 1.6);
      av.facePoint = new THREE.Vector3(STAGE.x, 0, STAGE.z + 10);
    } else {
      target = this.randomLoungePoint();
      av.facePoint = null;
      av.idleUntil = performance.now() + 6000 + Math.random() * 8000;
    }
    this.setPath(av, target);
  }

  randomLoungePoint() {
    // circulando: perto das janelas da frente ou no corredor entre o lounge e a sala de reunião
    return Math.random() < 0.5
      ? new THREE.Vector3(-7 + Math.random() * 4, 0, 9 + Math.random() * 4)
      : new THREE.Vector3(-16 + Math.random() * 12, 0, 14.6 + Math.random() * 0.4);
  }

  // Sorteia o que fazer quando está livre (só entre as vagas desocupadas).
  // Agente livre que pode virar parceiro de jogo (não está trabalhando, nem em reunião, nem já jogando em dupla).
  freePartner(av) {
    const cands = [...this.avatars.values()].filter((o) => o !== av && !o.human && !o.goSeat && this.effective(o) === 'idle' && !o.act?.partner);
    return cands.length ? cands[(Math.random() * cands.length) | 0] : null;
  }

  // Sorteia o que fazer quando está livre (só entre as vagas desocupadas).
  // Sinuca e pingue-pongue só entram no sorteio se houver mesa livre E alguém livre para fazer dupla.
  // A atividade dura até a pessoa ser chamada; o café é rápido (2 min) e depois ela escolhe outra coisa.
  pickActivity(av) {
    this.releaseActivity(av);
    this.taken ||= new Map();
    const partner = this.freePartner(av);
    const options = [];
    for (const act of ACTIVITIES) {
      const free = act.spots.map((s, i) => ({ s, i, key: `${act.id}:${i}` })).filter((x) => !this.taken.has(x.key));
      if (act.pair ? free.length === act.spots.length && partner : free.length) options.push({ act, free });
    }
    // No computador: vai para a própria mesa e fica navegando (a vaga é só dele).
    if (av.deskIndex != null && !this.taken.has(`desk:${av.agent.id}`)) {
      const { seat } = this.deskSlot(av.deskIndex);
      options.push({ act: DESK_ACT, free: [{ s: { x: seat.x, z: seat.z, ry: Math.PI }, i: 0, key: `desk:${av.agent.id}` }] });
    }
    const total = options.reduce((n, o) => n + o.act.weight, 0) + 1; // + chance de só circular
    let r = Math.random() * total;
    const pick = options.find((o) => (r -= o.act.weight) < 0);
    av.facePoint = null;
    if (!pick) { av.act = null; this.setPath(av, this.randomLoungePoint()); av.idleUntil = performance.now() + 15000 + Math.random() * 15000; return; }
    const until = pick.act.ms ? performance.now() + pick.act.ms * (pick.act.jitter ? 1 + Math.random() * pick.act.jitter : 1) : Infinity;
    if (pick.act.pair) {
      // chama o parceiro: cada um vai para um lado da mesa
      this.releaseActivity(partner);
      const [a, b] = Math.random() < 0.5 ? [pick.free[0], pick.free[1]] : [pick.free[1], pick.free[0]];
      this.assign(av, pick.act, a, partner, until);
      this.assign(partner, pick.act, b, av, until);
      return;
    }
    this.assign(av, pick.act, pick.free[(Math.random() * pick.free.length) | 0], null, until);
  }

  assign(av, act, spot, partner, until) {
    this.taken.set(spot.key, av.agent.id);
    av.act = { id: act.id, seated: act.seated, spot: spot.s, key: spot.key, partner: partner?.agent.id || null };
    av.idleUntil = until;
    av.facePoint = null;
    // até a própria mesa: entra pelo corredor entre as fileiras (não atravessa as mesas)
    if (act.id === 'desk') this.setPath(av, new THREE.Vector3(spot.s.x, 0, spot.s.z), this.deskSlot(av.deskIndex).gapX);
    else this.setPath(av, new THREE.Vector3(spot.s.x, 0, spot.s.z));
  }

  // Sai da atividade. Em dupla, quando um sai o outro também para (e vai fazer outra coisa).
  releaseActivity(av) {
    const a = av?.act;
    if (!a) return;
    av.act = null;
    if (this.taken?.get(a.key) === av.agent.id) this.taken.delete(a.key);
    if (a.partner) {
      const p = this.avatars.get(a.partner);
      if (p?.act?.partner === av.agent.id) {
        if (this.taken?.get(p.act.key) === p.agent.id) this.taken.delete(p.act.key);
        p.act = null;
        p.idleUntil = 0; // escolhe outra coisa no próximo quadro (se continuar livre)
      }
    }
  }

  // Dupla completa e os dois já na mesa?
  pairReady(av) {
    const p = av.act?.partner && this.avatars.get(av.act.partner);
    return !!(p && p.act?.partner === av.agent.id && !p.path.length && !av.path.length);
  }

  setPath(av, target, gapX) {
    const p = av.group.position;
    av.seated = false;
    const path = [];
    const startInDesks = p.z < AISLE_Z - 1 && p.x < -1;
    if (startInDesks) {
      const nearGap = this.nearestGapX(p.x);
      path.push(new THREE.Vector3(nearGap, 0, p.z), new THREE.Vector3(nearGap, 0, AISLE_Z));
    } else if (Math.abs(p.z - target.z) > 2.5) {
      path.push(new THREE.Vector3(p.x, 0, AISLE_Z));
    }
    if (gapX !== undefined) {
      path.push(new THREE.Vector3(gapX, 0, AISLE_Z), new THREE.Vector3(gapX, 0, target.z), target);
    } else {
      path.push(new THREE.Vector3(target.x, 0, AISLE_Z), target);
    }
    av.path = path;
  }

  nearestGapX(x) {
    let best = -19 + 2.2, d = Infinity;
    for (let c = -1; c < DESK_COLS; c++) {
      const gx = -19 + c * 4.4 + 2.2;
      if (Math.abs(gx - x) < d) { d = Math.abs(gx - x); best = gx; }
    }
    return best;
  }

  select(id) {
    if (this.selected) this.avatars.get(this.selected)?.ring && (this.avatars.get(this.selected).ring.visible = false);
    this.selected = id;
    const av = this.avatars.get(id);
    if (av) av.ring.visible = true;
  }

  focus(id) {
    const av = this.avatars.get(id);
    if (!av) return;
    const delta = av.group.position.clone().sub(this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
  }

  onAgentClick(fn) { this.clickHandlers.push(fn); }

  pick(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [];
    for (const av of this.avatars.values()) av.rig.traverse((m) => m.userData.agentId && meshes.push(m));
    const hit = this.raycaster.intersectObjects(meshes)[0];
    if (hit) { this.clickHandlers.forEach((fn) => fn(hit.object.userData.agentId)); return; }
    // Clique no chão: meu personagem anda até lá
    if (!this.meAv || !this.inputEnabled) return;
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return;
    if (p.x < FLOOR.x0 || p.x > FLOOR.x1 || p.z < FLOOR.z0 || p.z > FLOOR.z1) return;
    if (!this.player.active) this.startWalking();
    this.player.target = p;
    this.marker.position.set(p.x, 0.04, p.z);
    this.marker.visible = true;
  }

  // ---------------- meu personagem ----------------
  get meAv() { return this.meId ? this.avatars.get(this.meId) : null; }
  onProximity(fn) { this.proxHandlers.push(fn); }
  onFrame(fn) { this.frameHandlers.push(fn); }
  onWalkChange(fn) { this.walkHandlers.push(fn); }
  setInputEnabled(on) {
    this.inputEnabled = on;
    if (!on) { this.player.keys.clear(); this.player.joy = null; }
    this.container.classList.toggle('walk-off', !on);
  }

  initPlayer() {
    // marcador do destino (clique no chão)
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 28), new THREE.MeshBasicMaterial({ color: '#f2c200', transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    this.scene.add(this.marker);
    // painel de controle: botão andar/voltar + dica + joystick (toque)
    const hud = document.createElement('div');
    hud.className = 'walk-hud';
    hud.innerHTML = `<button type="button" class="walk-btn"><svg class="i" aria-hidden="true"><use href="/vendor/lucide/sprite.svg#footprints"/></svg><span class="walk-txt">Andar pelo escritório</span></button>
      <span class="walk-hint">WASD ou setas · clique no chão · Shift corre · Esc volta para a mesa</span>`;
    this.container.appendChild(hud);
    hud.querySelector('.walk-btn').onclick = () => (this.player.active ? this.stopWalking() : this.startWalking());
    this.hud = hud;
    const joy = document.createElement('div');
    joy.className = 'joy';
    joy.innerHTML = '<div class="joy-knob"></div>';
    this.container.appendChild(joy);
    const knob = joy.firstChild;
    let id = null;
    const move = (e) => {
      const r = joy.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
      knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
      this.player.joy = Math.hypot(x, y) > 0.15 ? { x, y } : null;
    };
    joy.addEventListener('pointerdown', (e) => { id = e.pointerId; joy.setPointerCapture(id); move(e); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = () => { id = null; this.player.joy = null; knob.style.transform = ''; };
    joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
    // teclado (só quando não está digitando e o escritório está na frente)
    const KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
    const typing = (e) => { const t = e.target; return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); };
    window.addEventListener('keydown', (e) => {
      if (!this.inputEnabled || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' && this.player.active) { this.stopWalking(); return; }
      if (!KEYS.includes(k)) return;
      if (k !== 'shift') { e.preventDefault(); if (!this.player.active) this.startWalking(); }
      this.player.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.player.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.player.keys.clear());
  }

  startWalking() {
    const me = this.meAv;
    if (!me) return;
    const P = this.player;
    P.active = true;
    me.goSeat = false; me.seated = false; me.pending = false; me.linger = false; me.path = [];
    // levanta da cadeira e dá um passo para o corredor
    me.group.position.z += 0.6;
    this.container.classList.add('walking');
    this.hud.querySelector('.walk-txt').textContent = 'Voltar para a mesa';
    this.walkHandlers.forEach((fn) => fn(true));
  }

  stopWalking() {
    const P = this.player;
    if (!P.active) return;
    P.active = false; P.target = null; P.joy = null; P.keys.clear();
    this.marker.visible = false;
    this.setNear(null);
    this.container.classList.remove('walking');
    this.hud.querySelector('.walk-txt').textContent = 'Andar pelo escritório';
    const me = this.meAv;
    if (me) { me.goSeat = false; this.route(me); }
    this.walkHandlers.forEach((fn) => fn(false));
  }

  // Obstáculos do piso (mesas, móveis, palco, plantas): retângulos e círculos no plano XZ.
  obstacles() {
    if (this._obs) return this._obs;
    const o = [];
    const rect = (x0, x1, z0, z1) => o.push({ x0, x1, z0, z1 });
    for (let i = 0; i < (this.desks || []).length; i++) { const { desk } = this.deskSlot(i); rect(desk.x - 1.35, desk.x + 1.35, desk.z - 0.7, desk.z + 0.62); }
    for (const t of MEETING_TABLES) o.push({ cx: t.x, cz: t.z, r: 1.1 });
    rect(STAGE.x - 1.55, STAGE.x + 1.55, STAGE.z - 0.55, STAGE.z + 0.55);
    rect(STAGE.x - 3.5, STAGE.x + 3.5, STAGE.z - 2.45, STAGE.z - 1.95);
    rect(-12.1, -8.9, 12.2, 13.4); rect(-12.1, -8.9, 7.6, 8.8); rect(-11.7, -9.3, 9.9, 11.1);
    rect(-19.2, -18, 8.9, 12.1); rect(-23, -21.9, 8.8, 12.2); rect(-21.1, -19.9, 0.9, 5.1);
    rect(11.5 - 1.75, 11.5 + 1.75, -11 - 1, -11 + 1);
    rect(17.5 - 1.45, 17.5 + 1.45, -5 - 0.8, -5 + 0.8);
    rect(15 - 4.4, 15 + 4.4, -16, -15.3);
    for (const [x, z] of PLANTS) o.push({ cx: x, cz: z, r: 0.42 });
    o.push(...(this.extraObstacles || []));
    this._obs = o;
    return o;
  }

  blocked(x, z, me, from) {
    const r = BODY_R;
    if (x < FLOOR.x0 + r || x > FLOOR.x1 - r || z < FLOOR.z0 + r || z > FLOOR.z1 - r) return true;
    for (const b of this.obstacles()) {
      if (b.r) { if (Math.hypot(x - b.cx, z - b.cz) < b.r + r) return true; }
      else if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true;
    }
    // não atravessa pessoas (mas sempre consegue se afastar)
    for (const o of this.avatars.values()) {
      if (o === me) continue;
      const p = o.group.position, d = Math.hypot(x - p.x, z - p.z);
      if (d < 0.72 && d < Math.hypot(from.x - p.x, from.z - p.z)) return true;
    }
    return false;
  }

  updatePlayer(av, dt) {
    const P = this.player, k = P.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    // direções relativas à câmera (para cima na tela = para frente)
    const fw = new THREE.Vector3(); this.camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
    const rt = new THREE.Vector3(-fw.z, 0, fw.x);
    const dir = new THREE.Vector3();
    let mag = 1;
    if (f || s) { dir.addScaledVector(fw, f).addScaledVector(rt, s); P.target = null; }
    else if (P.joy) { dir.addScaledVector(fw, -P.joy.y).addScaledVector(rt, P.joy.x); mag = Math.min(1, Math.hypot(P.joy.x, P.joy.y)); P.target = null; }
    else if (P.target) { dir.subVectors(P.target, av.group.position); dir.y = 0; if (dir.length() < 0.15) P.target = null; }
    if (!P.target) this.marker.visible = false;
    if (dir.lengthSq() < 1e-4) return false;
    dir.normalize();
    const pos = av.group.position, from = pos.clone();
    const step = (k.has('shift') ? RUN_SPEED : WALK_SPEED) * mag * dt;
    let moved = false;
    if (!this.blocked(pos.x + dir.x * step, pos.z, av, from)) { pos.x += dir.x * step; moved = true; }
    if (!this.blocked(pos.x, pos.z + dir.z * step, av, from)) { pos.z += dir.z * step; moved = true; }
    if (!moved && P.target) { P.target = null; this.marker.visible = false; }
    av.group.rotation.y = lerpAngle(av.group.rotation.y, Math.atan2(dir.x, dir.z), 0.3);
    return moved;
  }

  // Quem está perto de mim (com folga para não piscar na borda).
  checkNear(now) {
    const P = this.player, me = this.meAv;
    if (!P.active || !me || now < P.checkAt) return;
    P.checkAt = now + 150;
    const mp = me.group.position;
    let best = null, bd = Infinity;
    for (const o of this.avatars.values()) {
      if (o === me) continue;
      const d = o.group.position.distanceTo(mp);
      if (d < bd) { bd = d; best = o; }
    }
    const cur = P.near && this.avatars.get(P.near);
    if (cur && cur.group.position.distanceTo(mp) < TALK_OUT) return;
    this.setNear(best && bd < TALK_IN ? best.agent.id : null);
  }

  setNear(id) {
    const P = this.player;
    if (P.near === id) return;
    const prev = P.near && this.avatars.get(P.near);
    if (prev) prev.ring.visible = this.selected === P.near;
    P.near = id;
    const av = id && this.avatars.get(id);
    if (av) {
      av.ring.visible = true;
      // quem você encontra acena (se não estiver sentado trabalhando)
      if (av.model && !av.seated) av.model.play('Waving', { once: true });
    }
    this.proxHandlers.forEach((fn) => fn(id));
  }

  /** Posição na tela (px, relativa ao container) acima da cabeça de alguém. */
  screenOf(id) {
    const av = this.avatars.get(id);
    if (!av) return null;
    const v = av.group.position.clone(); v.y += av.seated ? 2.2 : 2.7;
    v.project(this.camera);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, w, h };
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight, aspect = w / h;
    this.frustum = aspect < 1.3 ? (34 * 1.3) / aspect : 34;
    Object.assign(this.camera, { left: -this.frustum * aspect / 2, right: this.frustum * aspect / 2, top: this.frustum / 2, bottom: -this.frustum / 2 });
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  // ---------------- animação ----------------
  tick() {
    // Movimento baseado no tempo real (funciona igual mesmo com FPS baixo).
    const dt = Math.min(this.clock.getDelta(), 1);
    const now = performance.now();
    this.gaming = false;
    this.ppPlayers?.clear();
    for (const av of this.avatars.values()) {
      av.phase += dt;
      const pos = av.group.position;
      let walking = false;
      const isPlayer = this.player.active && av === this.meAv;
      // Terminou o tempo mínimo na mesa: agora sim pode levantar.
      if (!isPlayer && av.pending && now >= (av.holdUntil || 0)) this.route(av);
      else if (!isPlayer && av.linger && now >= (av.stayUntil || 0)) this.route(av);
      if (isPlayer) {
        walking = this.updatePlayer(av, dt);
      } else if (this.player.near === av.agent.id && !av.seated && !av.path.length && !av.act && this.meAv) {
        // quem está conversando comigo vira para mim
        const d = this.meAv.group.position.clone().sub(pos);
        av.group.rotation.y = lerpAngle(av.group.rotation.y, Math.atan2(d.x, d.z), 0.12);
      } else if (av.path.length) {
        let budget = (av.hurry ? 5.6 : 3.4) * dt; // indo trabalhar: passo apressado
        while (budget > 0 && av.path.length) {
          const next = av.path[0];
          const dir = next.clone().sub(pos); dir.y = 0;
          const dist = dir.length();
          if (dist <= budget) { pos.copy(next); av.path.shift(); budget -= dist; continue; }
          dir.normalize();
          pos.addScaledVector(dir, budget);
          av.group.rotation.y = lerpAngle(av.group.rotation.y, Math.atan2(dir.x, dir.z), 0.35);
          budget = 0;
          walking = true;
        }
        if (!av.path.length) {
          av.seated = !!av.goSeat;
          av.hurry = false;
          // Sentou para trabalhar: garante alguns segundos de trabalho visível na mesa.
          if (av.seated && !av.human) av.holdUntil = Math.max(av.holdUntil || 0, now + 8000);
        }
      } else {
        if (av.goSeat) av.group.rotation.y = lerpAngle(av.group.rotation.y, av.facing, 0.15);
        else if (av.facePoint) {
          const d = av.facePoint.clone().sub(pos);
          av.group.rotation.y = lerpAngle(av.group.rotation.y, Math.atan2(d.x, d.z), 0.1);
        }
        if (av.act && !av.goSeat) av.group.rotation.y = lerpAngle(av.group.rotation.y, av.act.spot.ry, 0.12);
        if (!av.goSeat && !av.human && this.effective(av) === 'idle' && now > av.idleUntil) this.pickActivity(av);
      }

      // ---------- pose (transições suaves, sem "estalos") ----------
      const k = 1 - Math.exp(-dt * 9); // suavização independente do FPS
      const eff = this.effective(av);
      const busy = av.seated && (eff === 'working' || eff === 'thinking' || av.pending);
      // atividade de folga em andamento (chegou na vaga e está livre)
      const act = !walking && !av.path.length && av.act && eff === 'idle' && !av.goSeat ? av.act.id : null;
      const sitting = av.seated || (act && av.act.seated);
      av.sit = THREE.MathUtils.lerp(av.sit, sitting ? 1 : 0, 1 - Math.exp(-dt * 6));
      for (const [name, prop] of Object.entries(av.props)) prop.visible = act === { phone: 'phone', controller: 'game', mug: 'coffee', paddle: 'pingpong', cue: 'pool' }[name];
      if (act === 'game') this.gaming = true;
      // em dupla: só joga quando os dois chegaram; até lá espera na mesa segurando o taco/raquete
      const playing = (act === 'pool' || act === 'pingpong') ? this.pairReady(av) : !!act;
      if (act === 'pingpong' && playing) (this.ppPlayers ||= new Set()).add(av.act.key);
      if (act === 'pool') av.props.cue.position.z = playing ? 0.55 + Math.max(0, Math.sin(av.phase * 1.6)) * -0.25 + (Math.sin(av.phase * 1.6) > 0.97 ? 0.18 : 0) : 0.4;
      const stride = av.hurry ? 13 : 10;
      const swing = walking ? Math.sin(av.phase * stride) * (av.hurry ? 0.75 : 0.6) : 0;
      const bob = walking ? Math.abs(Math.sin(av.phase * stride)) * 0.07 : Math.sin(av.phase * 1.6) * 0.008; // respiração parado
      av.rig.position.y = THREE.MathUtils.lerp(bob, -0.32, av.sit);
      // pernas: andando balançam; sentado dobram
      av.legL.rotation.x = THREE.MathUtils.lerp(swing, -1.45, av.sit);
      av.legR.rotation.x = THREE.MathUtils.lerp(-swing, -1.45, av.sit);
      // tronco: inclina um pouco ao correr e para a frente ao digitar
      const lean = busy ? 0.16 + Math.sin(av.phase * 0.9) * 0.02 : walking && av.hurry ? 0.12
        : act === 'pool' ? (playing ? 0.55 : 0.08) : act === 'game' ? 0.12 + Math.sin(av.phase * 3) * 0.03 : act === 'pingpong' ? 0.18 : 0;
      av.torso.rotation.x = THREE.MathUtils.lerp(av.torso.rotation.x, lean, k);
      // cabeça: olha a tela, de vez em quando "lê"; no celular olha para baixo; no café, inclina ao beber
      const look = busy ? Math.sin(av.phase * 0.7) * 0.12 : act === 'pingpong' ? Math.sin(av.phase * 2.2) * 0.25 : 0;
      av.head.rotation.y = av.hairMesh.rotation.y = THREE.MathUtils.lerp(av.head.rotation.y, look, k);
      const sip = act === 'coffee' && (av.phase % 6) < 1.4;
      const nod = act === 'phone' ? 0.42 : sip ? -0.25 : 0;
      av.head.rotation.x = av.hairMesh.rotation.x = THREE.MathUtils.lerp(av.head.rotation.x, nod, k);
      if (act === 'phone') {
        // celular: duas mãos à frente, polegar rolando a tela
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -1.35 + Math.sin(av.phase * 7) * 0.04, k);
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -1.25, k);
      } else if (act === 'game') {
        // controle: mãos à frente, apertando botões rápido
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -1.15 + Math.sin(av.phase * 19) * 0.07, 0.5);
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -1.15 + Math.sin(av.phase * 17 + 1) * 0.07, 0.5);
      } else if (act === 'coffee') {
        // segura a xícara e dá um gole a cada poucos segundos
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, sip ? -2.45 : -0.95, k * 0.8);
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, 0, k);
      } else if (act === 'pool') {
        // debruçado na mesa, mãos no taco
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -0.9 + Math.max(0, Math.sin(av.phase * 1.6)) * 0.35, k);
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -1.45, k);
      } else if ((act === 'pingpong' || act === 'pool') && !playing) {
        // esperando o parceiro chegar
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -0.5, k);
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, 0, k);
      } else if (act === 'pingpong') {
        // raquete: balança acompanhando a bolinha
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -0.7 + Math.sin(now / 1000 * Math.PI * 1.1 + (av.act.key.endsWith('1') ? Math.PI : 0)) * 0.7, 0.4);
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -0.3, k);
        av.group.position.z = av.act.spot.z + Math.sin(av.phase * 1.3) * 0.12;
      } else if (busy) {
        if (eff === 'thinking') {
          // pensando: uma mão no queixo, a outra no teclado
          av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -2.3, k);
          av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -1.15, k);
        } else {
          // digitando em rajadas (com pausas curtas para "ler")
          const burst = Math.sin(av.phase * 0.8) > -0.4 ? 1 : 0.15;
          const t1 = Math.sin(av.phase * 22) * 0.16 * burst, t2 = Math.sin(av.phase * 22 + 1.7) * 0.16 * burst;
          av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -1.2 + t1, 0.5);
          av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -1.2 + t2, 0.5);
        }
      } else if (av.seated) {
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -1.0, k);
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, -1.0, k);
      } else {
        const talk = !walking && (eff === 'meeting' || eff === 'presenting') ? Math.sin(av.phase * 4) * 0.35 - 0.3 : 0;
        av.armL.rotation.x = THREE.MathUtils.lerp(av.armL.rotation.x, -swing * 0.8, 0.5);
        av.armR.rotation.x = THREE.MathUtils.lerp(av.armR.rotation.x, swing * 0.8 + talk, 0.5);
      }
      av.blob.scale.setScalar(1 - av.sit * 0.25);
      // nome logo acima da cabeça (desce junto quando senta)
      const head = av.model?.bones.head;
      if (head) {
        head.getWorldPosition(_v);
        av.label.position.y = _v.y - av.group.position.y + 0.95; // topo da cabeça/chapéu + folga
      } else av.label.position.y = 2.3 - av.sit * 0.32;
      if (av.model) this.animateModel(av, { walking, sitting, busy, eff, act, playing, run: av.hurry || (av === this.meAv && this.player.keys.has('shift')), dt, now });

      // aura de trabalho no chão
      const auraOn = busy && !av.human;
      av.aura.material.opacity = THREE.MathUtils.lerp(av.aura.material.opacity, auraOn ? 0.35 + Math.sin(now / 380) * 0.18 : 0, k);
      av.aura.material.color.set(eff === 'thinking' ? '#8f7fd0' : '#f2c200');
      av.aura.scale.setScalar(1 + (auraOn ? (Math.sin(now / 380) + 1) * 0.06 : 0));

      // mesa: cadeira gira para receber quem senta; monitor liga e mostra o trabalho
      const desk = this.desks?.[av.deskIndex];
      if (desk && !av.human) {
        const atPc = av.seated || (act === 'desk');
        desk.chair.rotation.y = THREE.MathUtils.lerp(desk.chair.rotation.y, atPc ? 0 : 0.5, k * 0.6);
        const mode = av.seated && (eff === 'working' || av.pending) ? 'work' : av.seated && eff === 'thinking' ? 'think' : act === 'desk' ? 'browse' : 'off';
        desk.on = THREE.MathUtils.lerp(desk.on, mode === 'off' ? 0 : 1, k);
        desk.glow.material.opacity = desk.on * 0.18 * (0.85 + Math.sin(now / 90) * 0.05);
        if (mode !== desk.mode || (mode !== 'off' && now - (desk.drawn || 0) > 110)) {
          desk.mode = mode; desk.drawn = now;
          this.drawScreen(desk, mode, now, av.work || { label: av.bubbleEl.textContent });
        }
      } else if (desk && av.human && desk.mode !== 'off') {
        desk.mode = 'off';
        this.drawScreen(desk, 'off', now);
      }

      if (av.bubbleUntil && now > av.bubbleUntil) { av.bubbleEl.classList.remove('show'); av.bubbleUntil = 0; }
    }
    // ---------- ambiente ----------
    // videogame liga quando alguém joga
    if (this.gaming && now - (this.gameDrawn || 0) > 90) { this.gameDrawn = now; this.drawGame(now, true); this.gameOn = true; }
    else if (!this.gaming && this.gameOn) { this.gameOn = false; this.drawGame(now, false); }
    // bolinha de pingue-pongue: vai e volta (contra a parede se só tiver um jogando)
    if (this.ppBall) {
      const n = this.ppPlayers?.size || 0;
      this.ppBall.visible = n > 0;
      if (n) {
        const solo = n === 1 ? [...this.ppPlayers][0] : null;
        const t = (now / 1000) * 1.1;
        const leg = Math.floor(t) % 2, f = t % 1;
        const L = this.pp.x - 1.25, R = this.pp.x + 1.25;
        const [a, b] = solo === 'pingpong:1' ? [R, this.pp.x + 0.2] : solo === 'pingpong:0' ? [L, this.pp.x - 0.2] : [L, R];
        const from = leg ? b : a, to = leg ? a : b;
        this.ppBall.position.set(from + (to - from) * f, 0.86 + Math.sin(f * Math.PI) * 0.45, this.pp.z + Math.sin(t * 2.3) * 0.25);
      }
    }
    // carros na rua
    for (const c of this.cars || []) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 75) c.position.x = -75;
      if (c.position.x < -75) c.position.x = 75;
    }

    // Câmera acompanha meu personagem enquanto ando (zoom e giro continuam livres).
    if (this.player.active && this.meAv) {
      const d = this.meAv.group.position.clone().sub(this.controls.target); d.y = 0;
      d.multiplyScalar(1 - Math.exp(-dt * 3.2));
      this.controls.target.add(d); this.camera.position.add(d);
      this.checkNear(now);
      if (this.marker.visible) this.marker.material.opacity = 0.55 + Math.sin(now / 160) * 0.35;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    for (const fn of this.frameHandlers) fn();
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
