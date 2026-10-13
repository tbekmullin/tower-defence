(function () {
  'use strict';

  /* ==================== Константы ==================== */
  const TILE = 40;
  const COLS = 20;
  const ROWS = 14;
  const GRASS_TOP = 0;
  const PATH_TOP = -3;

  const STORAGE_KEY = 'td_best_score_3d_v1';
  const MUTE_KEY = 'td_muted_3d_v1';

  const WAYPOINTS = [
    [-1, 1], [3, 1], [3, 5], [8, 5], [8, 2], [13, 2],
    [13, 9], [5, 9], [5, 11], [16, 11], [16, 6], [20, 6]
  ];

  const blocked = new Set();
  (function buildBlocked() {
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      const c1 = WAYPOINTS[i][0], r1 = WAYPOINTS[i][1];
      const c2 = WAYPOINTS[i + 1][0], r2 = WAYPOINTS[i + 1][1];
      const dc = Math.sign(c2 - c1);
      const dr = Math.sign(r2 - r1);
      let c = c1, r = r1;
      blocked.add(c + ',' + r);
      while (c !== c2 || r !== r2) {
        c += dc; r += dr;
        blocked.add(c + ',' + r);
      }
    }
  })();

  function gridToWorld(c, r) {
    return {
      x: (c - COLS / 2 + 0.5) * TILE,
      z: (r - ROWS / 2 + 0.5) * TILE
    };
  }
  function worldToGrid(x, z) {
    return {
      c: Math.floor((x + COLS * TILE / 2) / TILE),
      r: Math.floor((z + ROWS * TILE / 2) / TILE)
    };
  }

  const PATH = WAYPOINTS.map(function (p) {
    const w = gridToWorld(p[0], p[1]);
    return { x: w.x, z: w.z };
  });

  const TOWER_TYPES = {
    arrow: {
      name: 'Лучник', icon: '🏹', cost: 50,
      desc: 'Быстрая одиночная атака',
      range: 115, damage: 12, fireRate: 1.8,
      projSpeed: 480, projColor: 0xffe082,
      baseColor: 0x2e7d32, accentColor: 0x66bb6a
    },
    cannon: {
      name: 'Пушка', icon: '💣', cost: 120,
      desc: 'Урон по площади',
      range: 140, damage: 38, fireRate: 0.65, splash: 48,
      projSpeed: 320, projColor: 0xff8a65,
      baseColor: 0x37474f, accentColor: 0x78909c
    },
    frost: {
      name: 'Мороз', icon: '❄️', cost: 90,
      desc: 'Замедляет врагов',
      range: 105, damage: 7, fireRate: 1.1,
      slow: 0.45, slowDur: 1.6,
      projSpeed: 400, projColor: 0x81d4fa,
      baseColor: 0x0277bd, accentColor: 0x4fc3f7
    }
  };

  const MAX_LEVEL = 5;

  /* ==================== DOM ==================== */
  const el = {
    lives: document.getElementById('lives'),
    gold: document.getElementById('gold'),
    wave: document.getElementById('wave'),
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    shop: document.getElementById('shop'),
    info: document.getElementById('info'),
    startWave: document.getElementById('startWave'),
    speedBtn: document.getElementById('speedBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    muteBtn: document.getElementById('muteBtn'),
    resetBtn: document.getElementById('resetBtn'),
    toast: document.getElementById('toast'),
    overlay: document.getElementById('overlay'),
    finalScore: document.getElementById('finalScore'),
    finalBest: document.getElementById('finalBest'),
    newRecord: document.getElementById('newRecord'),
    restartBtn: document.getElementById('restartBtn'),
    scene: document.getElementById('scene'),
    views: document.getElementById('views')
  };

  /* ==================== Состояние ==================== */
  const state = {
    gold: 150,
    lives: 20,
    score: 0,
    wave: 0,
    best: loadBest(),
    muted: loadMuted(),
    enemies: [],
    towers: [],
    projectiles: [],
    particles: [],
    rings: [],
    damageNumbers: [],
    spawnQueue: [],
    spawnTimer: 0,
    spawnInterval: 0.85,
    waveActive: false,
    selectedType: 'arrow',
    selectedTower: null,
    paused: false,
    speed: 1,
    gameOver: false,
    mouse: { c: -1, r: -1, world: new THREE.Vector3() },
    newRecord: false,
    shake: { time: 0, mag: 0 },
    time: 0
  };

  let toastTimer = null;

  /* ==================== Хранилище ==================== */
  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch (e) {}
  }
  function loadMuted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }
  function saveMuted(v) {
    try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) {}
  }

  /* ==================== Звук ==================== */
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function sfx(type) {
    if (state.muted) return;
    const ac = getAudio();
    if (!ac) return;
    const t = ac.currentTime;

    if (type === 'explode' || type === 'leak') {
      const dur = type === 'explode' ? 0.32 : 0.4;
      const bufSize = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      const flt = ac.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = type === 'explode' ? 900 : 500;
      const g = ac.createGain();
      g.gain.value = type === 'explode' ? 0.09 : 0.06;
      src.connect(flt); flt.connect(g); g.connect(ac.destination);
      src.start(t);
      return;
    }

    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.connect(g); g.connect(ac.destination);

    switch (type) {
      case 'shoot':
        osc.type = 'square';
        osc.frequency.setValueAtTime(700, t);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.07);
        g.gain.setValueAtTime(0.025, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        osc.start(t); osc.stop(t + 0.07); break;
      case 'cannon':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.16);
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.start(t); osc.stop(t + 0.16); break;
      case 'frost':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900, t);
        osc.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
        g.gain.setValueAtTime(0.02, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.start(t); osc.stop(t + 0.12); break;
      case 'hit':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, t);
        osc.frequency.exponentialRampToValueAtTime(120, t + 0.05);
        g.gain.setValueAtTime(0.02, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        osc.start(t); osc.stop(t + 0.05); break;
      case 'place':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(850, t + 0.16);
        g.gain.setValueAtTime(0.055, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.start(t); osc.stop(t + 0.16); break;
      case 'upgrade':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(500, t);
        osc.frequency.exponentialRampToValueAtTime(1100, t + 0.2);
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.start(t); osc.stop(t + 0.2); break;
      case 'sell':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(700, t);
        osc.frequency.exponentialRampToValueAtTime(350, t + 0.15);
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.start(t); osc.stop(t + 0.15); break;
      case 'waveStart':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(520, t + 0.45);
        g.gain.setValueAtTime(0.045, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.start(t); osc.stop(t + 0.45); break;
      case 'waveClear':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(500, t);
        osc.frequency.exponentialRampToValueAtTime(900, t + 0.2);
        g.gain.setValueAtTime(0.055, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t); osc.stop(t + 0.35); break;
      case 'gameOver':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 1.1);
        g.gain.setValueAtTime(0.07, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
        osc.start(t); osc.stop(t + 1.1); break;
      case 'error':
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.14);
        g.gain.setValueAtTime(0.045, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.start(t); osc.stop(t + 0.14); break;
    }
  }

  /* ==================== Three.js ==================== */
  const CANVAS_W = 800;
  const CANVAS_H = 560;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1a0a);
  scene.fog = new THREE.Fog(0x0a1a0a, 1100, 2600);

  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(CANVAS_W, CANVAS_H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  el.scene.appendChild(renderer.domElement);

  let viewSize = 380;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 5000);

  // Текущее состояние камеры
  const cam = {
    target: new THREE.Vector3(0, 0, 0),
    dist: 1500,
    theta: -Math.PI * 0.22,
    phi: Math.PI / 3.6
  };

  // Целевое состояние камеры (к которому плавно стремимся)
  const camTarget = {
    theta: cam.theta,
    phi: cam.phi,
    dist: cam.dist,
    viewSize: viewSize
  };

  // Пресеты видов
  const PRESET_VIEWS = {
    iso:   { theta: -Math.PI * 0.22, phi: Math.PI / 3.6,   viewSize: 380 },
    top:   { theta: 0,               phi: 0.15,            viewSize: 380 },
    side:  { theta: 0,               phi: Math.PI / 2.15,  viewSize: 380 },
    front: { theta: Math.PI / 2,     phi: Math.PI / 2.4,   viewSize: 380 }
  };

  function updateProjection() {
    const aspect = CANVAS_W / CANVAS_H;
    camera.left = -viewSize * aspect;
    camera.right = viewSize * aspect;
    camera.top = viewSize;
    camera.bottom = -viewSize;
    camera.updateProjectionMatrix();
  }
  function updateCamera() {
    const r = cam.dist;
    const sp = Math.sin(cam.phi);
    camera.position.x = cam.target.x + r * sp * Math.sin(cam.theta);
    camera.position.y = cam.target.y + r * Math.cos(cam.phi);
    camera.position.z = cam.target.z + r * sp * Math.cos(cam.theta);
    camera.lookAt(cam.target);
  }
  updateProjection();
  updateCamera();

  function clearViewActive() {
    if (!el.views) return;
    const btns = el.views.querySelectorAll('.view-btn');
    for (let i = 0; i < btns.length; i++) btns[i].classList.remove('active');
  }

  function setView(name) {
    const p = PRESET_VIEWS[name];
    if (!p) return;
    camTarget.theta = p.theta;
    camTarget.phi = p.phi;
    camTarget.viewSize = p.viewSize;

    // Сбросить theta, чтобы поворот был в правильную сторону (кратчайшим путём)
    let dTheta = camTarget.theta - cam.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;

    if (el.views) {
      const btns = el.views.querySelectorAll('.view-btn');
      for (let i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].dataset.view === name);
      }
    }
  }

  // Свет
  const ambient = new THREE.AmbientLight(0x8899cc, 0.55);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(0x9ec7ff, 0x2a3d22, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffeec0, 1.15);
  sun.position.set(450, 900, 380);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -700;
  sun.shadow.camera.right = 700;
  sun.shadow.camera.top = 700;
  sun.shadow.camera.bottom = -700;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 2500;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /* ==================== Геометрии/материалы ==================== */
  const sharedGeo = {
    grass: new THREE.BoxGeometry(TILE - 2, 8, TILE - 2),
    path: new THREE.BoxGeometry(TILE - 2, 8, TILE - 2)
  };

  const tileMats = {
    grassA: new THREE.MeshStandardMaterial({color: 0x2c4a24, roughness: 0.95, metalness: 0.02}),
    grassB: new THREE.MeshStandardMaterial({color: 0x24401e, roughness: 0.95, metalness: 0.02}),
    pathA:  new THREE.MeshStandardMaterial({color: 0x6b5936, roughness: 0.95, metalness: 0.02}),
    pathB:  new THREE.MeshStandardMaterial({color: 0x5f4f30, roughness: 0.95, metalness: 0.02})
  };

  const HP_MATS = {
    bg: new THREE.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.75, depthTest: true}),
    hi: new THREE.MeshBasicMaterial({color: 0x66bb6a, depthTest: true}),
    mid: new THREE.MeshBasicMaterial({color: 0xffca28, depthTest: true}),
    lo: new THREE.MeshBasicMaterial({color: 0xef5350, depthTest: true})
  };

  const HP_BG_GEO = new THREE.PlaneGeometry(24, 4);
  const HP_FG_GEO = (function () {
    const g = new THREE.PlaneGeometry(24, 4);
    g.translate(12, 0, 0);
    return g;
  })();

  const PARTICLE_GEO = new THREE.SphereGeometry(1.6, 6, 5);
  const PARTICLE_MATS = {
    green: new THREE.MeshBasicMaterial({color: 0x81c784}),
    yellow: new THREE.MeshBasicMaterial({color: 0xffd54f}),
    orange: new THREE.MeshBasicMaterial({color: 0xff8a65}),
    red:    new THREE.MeshBasicMaterial({color: 0xff5252}),
    ice:    new THREE.MeshBasicMaterial({color: 0x81d4fa}),
    purple: new THREE.MeshBasicMaterial({color: 0xb06be0}),
    white:  new THREE.MeshBasicMaterial({color: 0xffffff})
  };

  const PROJ_GEO_SMALL = new THREE.SphereGeometry(3.2, 10, 8);
  const PROJ_GEO_BIG = new THREE.SphereGeometry(5, 10, 8);

  /* ==================== Построение сцены ==================== */
  function buildBoard() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const isPath = blocked.has(c + ',' + r);
        const w = gridToWorld(c, r);

        const mat = isPath
          ? (((c + r) % 2) ? tileMats.pathA : tileMats.pathB)
          : (((c + r) % 2) ? tileMats.grassA : tileMats.grassB);

        const geo = isPath ? sharedGeo.path : sharedGeo.grass;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(w.x, isPath ? (PATH_TOP - 4) : (GRASS_TOP - 4), w.z);
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    }

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS * TILE + 800, ROWS * TILE + 800),
      new THREE.MeshStandardMaterial({color: 0x152b12, roughness: 1.0})
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -12;
    plane.receiveShadow = true;
    scene.add(plane);

    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 560 + Math.random() * 380;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      scene.add(createTree(x, z, 0.7 + Math.random() * 0.8));
    }
  }

  function createTree(x, z, scale) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 5, 26, 7),
      new THREE.MeshStandardMaterial({color: 0x54351a, roughness: 0.95})
    );
    trunk.position.y = 13;
    trunk.castShadow = true;
    g.add(trunk);

    const foliageMat = new THREE.MeshStandardMaterial({
      color: 0x2a5a1a, roughness: 0.85, metalness: 0.02
    });
    const f1 = new THREE.Mesh(new THREE.IcosahedronGeometry(16, 0), foliageMat);
    f1.position.y = 34;
    f1.castShadow = true;
    g.add(f1);

    const f2 = new THREE.Mesh(new THREE.IcosahedronGeometry(12, 0), foliageMat);
    f2.position.set(6, 44, -3);
    f2.castShadow = true;
    g.add(f2);

    g.position.set(x, -8, z);
    g.scale.setScalar(scale);
    g.rotation.y = Math.random() * Math.PI * 2;
    return g;
  }

  /* ==================== Подсветка/призрак ==================== */
  const hoverMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE - 6, TILE - 6),
    new THREE.MeshBasicMaterial({
      color: 0x66bb6a, transparent: true, opacity: 0.35,
      depthWrite: false, side: THREE.DoubleSide
    })
  );
  hoverMesh.rotation.x = -Math.PI / 2;
  hoverMesh.visible = false;
  scene.add(hoverMesh);

  const rangeFill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.10,
      depthWrite: false, side: THREE.DoubleSide
    })
  );
  rangeFill.rotation.x = -Math.PI / 2;
  rangeFill.visible = false;
  scene.add(rangeFill);

  const rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.975, 1, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.75,
      depthWrite: false, side: THREE.DoubleSide
    })
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.visible = false;
  scene.add(rangeRing);

  let ghostTower = null;

  function clearGhost() {
    if (ghostTower) {
      scene.remove(ghostTower);
      ghostTower.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      ghostTower = null;
    }
  }

  function updateGhost() {
    clearGhost();
    if (!state.selectedType || state.gameOver) return;
    const c = state.mouse.c, r = state.mouse.r;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    if (blocked.has(c + ',' + r)) return;
    if (towerAt(c, r)) return;

    ghostTower = createTowerMesh(state.selectedType, true);
    const w = gridToWorld(c, r);
    ghostTower.position.set(w.x, GRASS_TOP, w.z);
    scene.add(ghostTower);
  }

  /* ==================== Модели башен ==================== */
  function createTowerMesh(type, ghost) {
    const b = TOWER_TYPES[type];
    const group = new THREE.Group();

    function mat(color, opts) {
      opts = opts || {};
      const m = new THREE.MeshStandardMaterial({
        color: color,
        roughness: opts.roughness !== undefined ? opts.roughness : 0.6,
        metalness: opts.metalness !== undefined ? opts.metalness : 0.25,
        emissive: opts.emissive || 0x000000,
        emissiveIntensity: opts.emissiveIntensity || 0
      });
      if (ghost) {
        m.transparent = true;
        m.opacity = 0.45;
      }
      return m;
    }

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(15, 17, 10, 18),
      mat(b.baseColor)
    );
    base.position.y = 5;
    base.castShadow = !ghost;
    base.receiveShadow = !ghost;
    group.add(base);

    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(15.5, 15.5, 2, 18),
      mat(b.accentColor, {metalness: 0.5, roughness: 0.35})
    );
    belt.position.y = 8;
    if (!ghost) belt.castShadow = true;
    group.add(belt);

    const turret = new THREE.Group();
    turret.position.y = 11;

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(8, 14, 10),
      mat(b.accentColor, {metalness: 0.45, roughness: 0.35})
    );
    if (!ghost) dome.castShadow = true;
    turret.add(dome);

    let barrel;
    if (type === 'arrow') {
      barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(2, 2.4, 22, 10),
        mat(0xd4a860, {metalness: 0.7, roughness: 0.28})
      );
      barrel.rotation.z = Math.PI / 2;
      barrel.position.x = 12;
    } else if (type === 'cannon') {
      barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(4.5, 5.5, 20, 12),
        mat(0x22262a, {metalness: 0.85, roughness: 0.35})
      );
      barrel.rotation.z = Math.PI / 2;
      barrel.position.x = 11;

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(4.6, 0.9, 6, 16),
        mat(0x6b6b6b, {metalness: 0.9, roughness: 0.3})
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = 12;
      turret.add(ring);
    } else if (type === 'frost') {
      barrel = new THREE.Mesh(
        new THREE.OctahedronGeometry(6, 0),
        mat(0x81d4fa, {metalness: 0.3, roughness: 0.15, emissive: 0x2266aa, emissiveIntensity: 0.6})
      );
      barrel.position.x = 10;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sp = new THREE.Mesh(
          new THREE.OctahedronGeometry(2, 0),
          mat(0x4fc3f7, {emissive: 0x2266aa, emissiveIntensity: 0.7})
        );
        sp.position.set(10 + Math.cos(a) * 6, Math.sin(a) * 6, 0);
        turret.add(sp);
      }
    }
    if (!ghost) barrel.castShadow = true;
    turret.add(barrel);

    group.add(turret);
    group.userData.turret = turret;
    group.userData.barrel = barrel;

    const dots = new THREE.Group();
    for (let i = 0; i < MAX_LEVEL; i++) {
      const d = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 8, 6),
        mat(0xffd54f, {emissive: 0x554400, emissiveIntensity: 0.5})
      );
      const a = (i / MAX_LEVEL) * Math.PI * 2 - Math.PI / 2;
      d.position.set(Math.cos(a) * 17, 0.5, Math.sin(a) * 17);
      d.visible = false;
      dots.add(d);
    }
    group.add(dots);
    group.userData.dots = dots;

    return group;
  }

  function updateTowerDots(tower) {
    const dots = tower.mesh.userData.dots;
    if (!dots) return;
    for (let i = 0; i < dots.children.length; i++) {
      dots.children[i].visible = i < tower.level;
    }
  }

  /* ==================== Модели врагов ==================== */
  function createEnemyMesh(enemy) {
    const group = new THREE.Group();
    const r = enemy.radius;

    let bodyGeo;
    if (enemy.isTank) {
      bodyGeo = new THREE.BoxGeometry(r * 1.8, r * 1.8, r * 1.8, 2, 2, 2);
    } else {
      bodyGeo = new THREE.IcosahedronGeometry(r, 0);
    }

    const bodyMat = new THREE.MeshStandardMaterial({
      color: enemy.color,
      roughness: 0.55,
      metalness: 0.15,
      emissive: 0x000000,
      emissiveIntensity: 0
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    group.add(body);
    group.userData.body = body;

    const hpGroup = new THREE.Group();
    hpGroup.position.y = r + 14;

    const bg = new THREE.Mesh(HP_BG_GEO, HP_MATS.bg);
    hpGroup.add(bg);

    const fg = new THREE.Mesh(HP_FG_GEO, HP_MATS.hi);
    fg.position.set(-12, 0, 0.1);
    hpGroup.add(fg);

    group.add(hpGroup);
    group.userData.hpGroup = hpGroup;
    group.userData.hpFill = fg;

    const freezeRing = new THREE.Mesh(
      new THREE.TorusGeometry(r + 3, 1.2, 6, 20),
      new THREE.MeshBasicMaterial({
        color: 0x81d4fa, transparent: true, opacity: 0.7
      })
    );
    freezeRing.rotation.x = Math.PI / 2;
    freezeRing.visible = false;
    group.add(freezeRing);
    group.userData.freezeRing = freezeRing;

    return group;
  }

  /* ==================== Магазин ==================== */
  function buildShop() {
    el.shop.innerHTML = '';
    Object.keys(TOWER_TYPES).forEach(function (type) {
      const b = TOWER_TYPES[type];
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      btn.dataset.type = type;
      btn.innerHTML =
        '<span class="ico">' + b.icon + '</span>' +
        '<span class="txt">' +
          '<span class="nm">' + b.name + '</span>' +
          '<span class="ds">' + b.desc + '</span>' +
        '</span>' +
        '<span class="cost">' + b.cost + '</span>';
      btn.addEventListener('click', function () {
        state.selectedType = (state.selectedType === type) ? null : type;
        state.selectedTower = null;
        refreshShop();
        refreshInfo();
      });
      el.shop.appendChild(btn);
    });
  }

  function refreshShop() {
    const btns = el.shop.querySelectorAll('.shop-btn');
    for (let i = 0; i < btns.length; i++) {
      const btn = btns[i];
      const type = btn.dataset.type;
      const cost = TOWER_TYPES[type].cost;
      btn.classList.toggle('active', state.selectedType === type);
      btn.disabled = state.gold < cost || state.gameOver;
    }
  }

  /* ==================== Инфо ==================== */
  function towerStats(t) {
    const b = TOWER_TYPES[t.type];
    const l = t.level - 1;
    return {
      range: b.range * Math.pow(1.12, l),
      damage: b.damage * Math.pow(1.5, l),
      fireRate: b.fireRate * Math.pow(1.12, l),
      splash: b.splash ? b.splash * Math.pow(1.08, l) : 0,
      slow: b.slow || 0,
      slowDur: b.slowDur || 0,
      projSpeed: b.projSpeed,
      projColor: b.projColor
    };
  }

  function upgradeCost(t) {
    return Math.round(TOWER_TYPES[t.type].cost * 0.75 * t.level);
  }
  function sellValue(t) {
    return Math.floor(t.invested * 0.6);
  }

  function refreshInfo() {
    const t = state.selectedTower;

    if (!t) {
      if (state.selectedType) {
        const b = TOWER_TYPES[state.selectedType];
        el.info.innerHTML =
          '<div class="title">' + b.icon + ' ' + b.name + '</div>' +
          '<div class="row"><span>Цена</span><b>' + b.cost + '</b></div>' +
          '<div class="row"><span>Урон</span><b>' + b.damage + '</b></div>' +
          '<div class="row"><span>Радиус</span><b>' + Math.round(b.range) + '</b></div>' +
          '<div class="row"><span>Скорость</span><b>' + b.fireRate.toFixed(1) + '/с</b></div>' +
          '<div style="margin-top:6px;color:#9db894">Кликните по свободной клетке, чтобы построить.</div>';
      } else {
        el.info.innerHTML = '<div class="empty">Выберите башню в магазине или кликните по уже построенной.</div>';
      }
      return;
    }

    const b = TOWER_TYPES[t.type];
    const st = towerStats(t);
    const maxed = t.level >= MAX_LEVEL;
    const upCost = upgradeCost(t);
    const sv = sellValue(t);

    let html = '';
    html += '<div class="title">' + b.icon + ' ' + b.name + ' (ур. ' + t.level + ')</div>';
    html += '<div class="row"><span>Урон</span><b>' + Math.round(st.damage) + '</b></div>';
    html += '<div class="row"><span>Радиус</span><b>' + Math.round(st.range) + '</b></div>';
    html += '<div class="row"><span>Скорость</span><b>' + st.fireRate.toFixed(2) + '/с</b></div>';
    if (st.splash) html += '<div class="row"><span>По площади</span><b>' + Math.round(st.splash) + '</b></div>';
    if (st.slow) html += '<div class="row"><span>Замедление</span><b>' + Math.round((1 - st.slow) * 100) + '%</b></div>';
    html += '<div class="row"><span>DPS</span><b>' + Math.round(st.damage * st.fireRate) + '</b></div>';

    html += '<div class="info-actions">';
    if (maxed) {
      html += '<button class="btn" disabled>МАКС</button>';
    } else {
      html += '<button class="btn primary" id="upBtn">Улучшить (' + upCost + ')</button>';
    }
    html += '<button class="btn danger" id="sellBtn">Продать (' + sv + ')</button>';
    html += '</div>';

    el.info.innerHTML = html;

    const upBtn = document.getElementById('upBtn');
    if (upBtn) {
      upBtn.disabled = state.gold < upCost;
      upBtn.addEventListener('click', function () { upgradeTower(t); });
    }
    const sellBtn = document.getElementById('sellBtn');
    if (sellBtn) {
      sellBtn.addEventListener('click', function () { sellTower(t); });
    }
  }

  function upgradeTower(t) {
    if (state.gameOver || t.level >= MAX_LEVEL) return;
    const cost = upgradeCost(t);
    if (state.gold < cost) {
      showToast('Недостаточно золота');
      sfx('error');
      return;
    }
    state.gold -= cost;
    t.invested += cost;
    t.level++;
    sfx('upgrade');
    updateTowerDots(t);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 40;
      spawnParticle(
        t.worldX + Math.cos(a) * 8, 8 + Math.random() * 15, t.worldZ + Math.sin(a) * 8,
        Math.cos(a) * speed, 40 + Math.random() * 40, Math.sin(a) * speed,
        PARTICLE_MATS.yellow, 0.7
      );
    }
    addRing(t.worldX, 2, t.worldZ, 34, 0xffd54f);
    refreshInfo();
  }

  function sellTower(t) {
    if (state.gameOver) return;
    const idx = state.towers.indexOf(t);
    if (idx === -1) return;
    state.gold += sellValue(t);
    scene.remove(t.mesh);
    disposeObj(t.mesh);
    if (state.selectedTower === t) state.selectedTower = null;
    state.towers.splice(idx, 1);
    sfx('sell');
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      spawnParticle(
        t.worldX, 8, t.worldZ,
        Math.cos(a) * 70, 60, Math.sin(a) * 70,
        PARTICLE_MATS.yellow, 0.6
      );
    }
    refreshInfo();
  }

  /* ==================== Утилиты ==================== */
  function key(c, r) { return c + ',' + r; }

  function towerAt(c, r) {
    for (let i = 0; i < state.towers.length; i++) {
      if (state.towers[i].c === c && state.towers[i].r === r) return state.towers[i];
    }
    return null;
  }

  function disposeObj(obj) {
    obj.traverse(function (o) {
      if (o.geometry && o.geometry !== sharedGeo.grass && o.geometry !== sharedGeo.path &&
          o.geometry !== HP_BG_GEO && o.geometry !== HP_FG_GEO && o.geometry !== PARTICLE_GEO &&
          o.geometry !== PROJ_GEO_SMALL && o.geometry !== PROJ_GEO_BIG) {
        o.geometry.dispose();
      }
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (m !== HP_MATS.bg && m !== HP_MATS.hi && m !== HP_MATS.mid && m !== HP_MATS.lo &&
              Object.values(PARTICLE_MATS).indexOf(m) === -1 &&
              Object.values(tileMats).indexOf(m) === -1) {
            m.dispose();
          }
        });
      }
    });
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    el.toast.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.style.opacity = '0'; }, 1200);
  }

  function checkBest() {
    if (state.score > state.best) {
      state.best = state.score;
      state.newRecord = true;
      saveBest(state.best);
    }
  }

  function addShake(mag) {
    state.shake.mag = Math.max(state.shake.mag, mag);
    state.shake.time = Math.max(state.shake.time, 0.22);
  }

  /* ==================== Частицы/эффекты ==================== */
  function spawnParticle(x, y, z, vx, vy, vz, mat, life) {
    const m = new THREE.Mesh(PARTICLE_GEO, mat);
    m.position.set(x, y, z);
    scene.add(m);
    state.particles.push({
      mesh: m,
      vx: vx, vy: vy, vz: vz,
      life: life, maxLife: life
    });
  }

  function spawnBurst(x, y, z, mat, count, spread) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const sp = spread * (0.4 + Math.random() * 0.8);
      spawnParticle(
        x, y, z,
        Math.cos(a) * Math.cos(b) * sp,
        Math.sin(b) * sp + 20,
        Math.sin(a) * Math.cos(b) * sp,
        mat, 0.5 + Math.random() * 0.4
      );
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 90 * dt;
      const damp = Math.max(0, 1 - 3.5 * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.life -= dt;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        state.particles.splice(i, 1);
        continue;
      }
      const a = p.life / p.maxLife;
      p.mesh.scale.setScalar(0.6 + a * 0.7);
    }
  }

  function addRing(x, y, z, maxR, color) {
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: 0.85,
      side: THREE.DoubleSide, depthWrite: false
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.3, z);
    m.scale.setScalar(maxR * 0.15);
    scene.add(m);
    state.rings.push({
      mesh: m,
      life: 0.42, maxLife: 0.42,
      maxR: maxR
    });
  }

  function updateRings(dt) {
    for (let i = state.rings.length - 1; i >= 0; i--) {
      const r = state.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        state.rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const s = r.maxR * (0.15 + 0.9 * t);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (r.life / r.maxLife) * 0.85;
    }
  }

  function makeTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const c = canvas.getContext('2d');
    c.font = 'bold 40px "Segoe UI", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.strokeStyle = 'rgba(0,0,0,0.8)';
    c.lineWidth = 6;
    c.strokeText(text, 64, 34);
    c.fillStyle = color;
    c.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({map: tex, transparent: true, depthTest: false});
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(32, 16, 1);
    sprite.renderOrder = 1000;
    return sprite;
  }

  function addDamageNumber(x, y, z, text, color) {
    const s = makeTextSprite(text, color);
    s.position.set(x, y, z);
    scene.add(s);
    state.damageNumbers.push({
      sprite: s,
      life: 0.85, maxLife: 0.85,
      vy: 26
    });
  }

  function updateDamageNumbers(dt) {
    for (let i = state.damageNumbers.length - 1; i >= 0; i--) {
      const d = state.damageNumbers[i];
      d.life -= dt;
      if (d.life <= 0) {
        scene.remove(d.sprite);
        d.sprite.material.map.dispose();
        d.sprite.material.dispose();
        state.damageNumbers.splice(i, 1);
        continue;
      }
      d.sprite.position.y += d.vy * dt;
      d.vy *= 0.94;
      d.sprite.material.opacity = Math.min(1, d.life / d.maxLife * 1.6);
    }
  }

  /* ==================== Волны ==================== */
  function startWave() {
    if (state.gameOver || state.waveActive) return;

    state.wave++;
    const n = state.wave;
    const count = 5 + Math.floor(n * 1.6);
    const baseHp = Math.round(28 * Math.pow(1.18, n - 1));
    const baseSpeed = 42 + n * 2.2;
    const baseReward = 4 + Math.floor(n * 0.8);

    state.spawnQueue = [];
    for (let i = 0; i < count; i++) {
      const isTank = ((i + 1) % 5 === 0) && n >= 2;
      state.spawnQueue.push({
        hp: isTank ? Math.round(baseHp * 2.5) : baseHp,
        speed: isTank ? baseSpeed * 0.65 : baseSpeed,
        reward: isTank ? baseReward * 2 : baseReward,
        radius: isTank ? 11 : 8,
        color: isTank ? 0xc0392b : 0x8e44ad,
        ring: isTank ? 0xff7043 : 0xb06be0,
        isTank: isTank
      });
    }

    state.spawnTimer = 0;
    state.spawnInterval = Math.max(0.32, 0.85 - n * 0.02);
    state.waveActive = true;
    sfx('waveStart');
    refreshShop();
  }

  function spawnEnemy(tpl) {
    const start = PATH[0];
    const enemy = {
      x: start.x, z: start.z, wp: 1,
      hp: tpl.hp, maxHp: tpl.hp,
      speed: tpl.speed, reward: tpl.reward,
      radius: tpl.radius, color: tpl.color, ring: tpl.ring,
      isTank: tpl.isTank,
      slowTimer: 0, slowFactor: 1,
      dead: false, leaked: false,
      hitFlash: 0,
      bobPhase: Math.random() * Math.PI * 2,
      mesh: null
    };
    const mesh = createEnemyMesh(enemy);
    scene.add(mesh);
    enemy.mesh = mesh;
    state.enemies.push(enemy);
  }

  function updateSpawning(dt) {
    if (!state.waveActive) return;

    if (state.spawnQueue.length > 0) {
      state.spawnTimer -= dt;
      while (state.spawnTimer <= 0 && state.spawnQueue.length > 0) {
        spawnEnemy(state.spawnQueue.shift());
        state.spawnTimer += state.spawnInterval;
      }
    }

    if (state.spawnQueue.length === 0 && state.enemies.length === 0) {
      state.waveActive = false;
      const bonus = 25 + state.wave * 6;
      state.gold += bonus;
      state.score += bonus;
      checkBest();
      sfx('waveClear');
      showToast('Волна ' + state.wave + ' отбита! +' + bonus + ' золота');
      refreshShop();
    }
  }

  /* ==================== Враги ==================== */
  function updateEnemies(dt) {
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;

      if (e.slowTimer > 0) e.slowTimer -= dt;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      e.bobPhase += dt * 7;

      const mul = e.slowTimer > 0 ? e.slowFactor : 1;
      let remaining = e.speed * mul * dt;

      while (remaining > 0 && e.wp < PATH.length) {
        const t = PATH[e.wp];
        const dx = t.x - e.x;
        const dz = t.z - e.z;
        const d = Math.hypot(dx, dz);
        if (d <= remaining) {
          e.x = t.x; e.z = t.z;
          e.wp++;
          remaining -= d;
        } else {
          e.x += (dx / d) * remaining;
          e.z += (dz / d) * remaining;
          remaining = 0;
        }
      }

      const bob = Math.sin(e.bobPhase) * 1.5;
      const y = PATH_TOP + e.radius + 2 + bob;
      e.mesh.position.set(e.x, y, e.z);

      const ratio = Math.max(0, e.hp / e.maxHp);
      const fg = e.mesh.userData.hpFill;
      fg.scale.x = Math.max(0.001, ratio);
      if (ratio > 0.6) fg.material = HP_MATS.hi;
      else if (ratio > 0.3) fg.material = HP_MATS.mid;
      else fg.material = HP_MATS.lo;

      e.mesh.userData.hpGroup.quaternion.copy(camera.quaternion);

      const fr = e.mesh.userData.freezeRing;
      fr.visible = e.slowTimer > 0;
      if (fr.visible) fr.rotation.z += dt * 3;

      const body = e.mesh.userData.body;
      if (e.hitFlash > 0) {
        body.material.emissive.setHex(0xffffff);
        body.material.emissiveIntensity = e.hitFlash * 8;
      } else {
        body.material.emissiveIntensity = 0;
      }

      if (e.wp >= PATH.length && !e.dead) {
        e.dead = true;
        e.leaked = true;
        state.lives -= 1;
        sfx('leak');
        addShake(6);
        spawnBurst(e.x, y, e.z, PARTICLE_MATS.red, 14, 130);
        addRing(e.x, PATH_TOP, e.z, 30, 0xff5252);
        if (state.lives <= 0) {
          state.lives = 0;
          gameOver();
        }
      }
    }
  }

  function hitEnemy(e, dmg, opts) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hitFlash = 0.09;

    if (opts && opts.slow) {
      e.slowFactor = Math.min(e.slowFactor, opts.slow);
      e.slowTimer = Math.max(e.slowTimer, opts.slowDur);
    }

    const py = e.mesh.position.y + e.radius;
    if (dmg >= 3) {
      addDamageNumber(
        e.x + (Math.random() - 0.5) * 8,
        py + 8,
        e.z + (Math.random() - 0.5) * 8,
        Math.round(dmg).toString(),
        opts && opts.slow ? '#81d4fa' : '#ffe082'
      );
    }

    spawnBurst(e.x, e.mesh.position.y, e.z, PARTICLE_MATS.yellow, 4, 70);

    if (e.hp <= 0) {
      e.dead = true;
      state.gold += e.reward;
      state.score += Math.round(e.maxHp) + 5;
      sfx('hit');
      spawnBurst(e.x, e.mesh.position.y, e.z, PARTICLE_MATS.purple, 14, 130);
      spawnBurst(e.x, e.mesh.position.y, e.z, PARTICLE_MATS.orange, 8, 150);
      addRing(e.x, PATH_TOP, e.z, e.radius * 2.4, e.ring);
      checkBest();
    }
  }

  /* ==================== Башни ==================== */
  function findTarget(t, range) {
    let best = null;
    let bestProgress = -Infinity;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.dead) continue;
      const d = Math.hypot(e.x - t.worldX, e.z - t.worldZ);
      if (d > range + e.radius) continue;
      const nx = PATH[Math.min(e.wp, PATH.length - 1)];
      const progress = e.wp * 10000 - Math.hypot(nx.x - e.x, nx.z - e.z);
      if (progress > bestProgress) {
        bestProgress = progress;
        best = e;
      }
    }
    return best;
  }

  function updateTowers(dt) {
    for (let i = 0; i < state.towers.length; i++) {
      const t = state.towers[i];
      const st = towerStats(t);
      if (t.cooldown > 0) t.cooldown -= dt;
      if (t.recoil > 0) t.recoil -= dt * 4;

      const turret = t.mesh.userData.turret;
      const barrel = t.mesh.userData.barrel;

      const target = findTarget(t, st.range);
      if (target) {
        const want = Math.atan2(-(target.z - t.worldZ), target.x - t.worldX);
        let da = want - turret.rotation.y;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        turret.rotation.y += da * Math.min(1, dt * 12);

        if (t.cooldown <= 0 && Math.abs(da) < 0.35) {
          t.cooldown = 1 / st.fireRate;
          t.recoil = 1;
          if (barrel) {
            barrel.position.x = (t.type === 'cannon' ? 11 : (t.type === 'frost' ? 10 : 12)) - 2;
          }
          fire(t, st, target);
        }
      }

      if (t.recoil > 0 && barrel) {
        const baseX = (t.type === 'cannon' ? 11 : (t.type === 'frost' ? 10 : 12));
        barrel.position.x += (baseX - barrel.position.x) * Math.min(1, dt * 10);
      } else if (barrel) {
        const baseX = (t.type === 'cannon' ? 11 : (t.type === 'frost' ? 10 : 12));
        barrel.position.x = baseX;
      }
    }
  }

  function fire(t, st, target) {
    const turret = t.mesh.userData.turret;
    const localBarrel = new THREE.Vector3(22, 12, 0);
    localBarrel.applyAxisAngle(new THREE.Vector3(0, 1, 0), turret.rotation.y);
    const bx = t.worldX + localBarrel.x;
    const bz = t.worldZ + localBarrel.z;
    const by = GRASS_TOP + 11;

    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      spawnParticle(
        bx, by, bz,
        Math.cos(a) * 40, 20 + Math.random() * 40, Math.sin(a) * 40,
        PARTICLE_MATS.yellow, 0.15
      );
    }

    if (t.type === 'cannon') sfx('cannon');
    else if (t.type === 'frost') sfx('frost');
    else sfx('shoot');

    const geo = st.splash ? PROJ_GEO_BIG : PROJ_GEO_SMALL;
    const mat = new THREE.MeshBasicMaterial({color: st.projColor});
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(bx, by, bz);
    scene.add(mesh);

    state.projectiles.push({
      mesh: mesh,
      x: bx, y: by, z: bz,
      startX: bx, startY: by, startZ: bz,
      target: target,
      lastX: target.x,
      lastY: target.mesh.position.y,
      lastZ: target.z,
      speed: st.projSpeed,
      damage: st.damage,
      splash: st.splash,
      slow: st.slow,
      slowDur: st.slowDur,
      color: st.projColor,
      colorHex: new THREE.Color(st.projColor),
      isSplash: st.splash > 0,
      dead: false
    });
  }

  /* ==================== Снаряды ==================== */
  function updateProjectiles(dt) {
    for (let i = 0; i < state.projectiles.length; i++) {
      const p = state.projectiles[i];
      if (p.dead) continue;

      const alive = p.target && !p.target.dead;
      const tx = alive ? p.target.x : p.lastX;
      const ty = alive ? p.target.mesh.position.y : p.lastY;
      const tz = alive ? p.target.z : p.lastZ;
      p.lastX = tx; p.lastY = ty; p.lastZ = tz;

      const dx = tx - p.x;
      const dy = ty - p.y;
      const dz = tz - p.z;
      const d = Math.hypot(dx, dy, dz);

      if (Math.random() < 0.7) {
        spawnParticle(
          p.x, p.y, p.z,
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 15,
          p.isSplash ? PARTICLE_MATS.orange : PARTICLE_MATS.yellow,
          0.25
        );
      }

      if (d <= p.speed * dt + 3) {
        p.x = tx; p.y = ty; p.z = tz;
        explode(p);
        p.dead = true;
        scene.remove(p.mesh);
        p.mesh.material.dispose();
      } else {
        p.x += (dx / d) * p.speed * dt;
        p.y += (dy / d) * p.speed * dt;
        p.z += (dz / d) * p.speed * dt;
        p.mesh.position.set(p.x, p.y, p.z);
      }
    }
  }

  function explode(p) {
    if (p.splash > 0) {
      sfx('explode');
      addShake(4);
      addRing(p.x, PATH_TOP, p.z, p.splash * 1.2, 0xffb74d);
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.dead) continue;
        if (Math.hypot(e.x - p.x, e.z - p.z) <= p.splash + e.radius) {
          hitEnemy(e, p.damage, p);
        }
      }
      spawnBurst(p.x, p.y, p.z, PARTICLE_MATS.orange, 20, p.splash * 2.4);
      spawnBurst(p.x, p.y, p.z, PARTICLE_MATS.yellow, 10, p.splash * 1.8);
      spawnBurst(p.x, p.y, p.z, PARTICLE_MATS.red, 6, p.splash * 1.3);
    } else {
      if (p.target && !p.target.dead) {
        hitEnemy(p.target, p.damage, p);
      }
      spawnBurst(p.x, p.y, p.z, PARTICLE_MATS.white, 5, 70);
    }
  }

  /* ==================== Главный апдейт ==================== */
  function update(dt) {
    state.time += dt;
    updateSpawning(dt);
    updateEnemies(dt);
    updateTowers(dt);
    updateProjectiles(dt);
    updateParticles(dt);
    updateRings(dt);
    updateDamageNumbers(dt);

    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      if (e.dead) {
        scene.remove(e.mesh);
        disposeObj(e.mesh);
        state.enemies.splice(i, 1);
      }
    }
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      if (state.projectiles[i].dead) {
        state.projectiles.splice(i, 1);
      }
    }

    if (state.shake.time > 0) {
      state.shake.time -= dt;
      if (state.shake.time <= 0) {
        state.shake.time = 0;
        state.shake.mag = 0;
      }
    }
  }

  /* ==================== Hover/подсветка ==================== */
  function updateMouseFromEvent(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(ndc, camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, point)) {
      const g = worldToGrid(point.x, point.z);
      state.mouse.c = g.c;
      state.mouse.r = g.r;
      state.mouse.world.copy(point);
    } else {
      state.mouse.c = -1;
      state.mouse.r = -1;
    }
  }

  function updateHoverVisuals() {
    const c = state.mouse.c, r = state.mouse.r;

    hoverMesh.visible = false;
    rangeFill.visible = false;
    rangeRing.visible = false;
    clearGhost();

    if (state.selectedTower) {
      const t = state.selectedTower;
      const st = towerStats(t);
      rangeFill.position.set(t.worldX, GRASS_TOP + 0.6, t.worldZ);
      rangeRing.position.set(t.worldX, GRASS_TOP + 0.6, t.worldZ);
      rangeFill.scale.setScalar(st.range);
      rangeRing.scale.setScalar(st.range);
      rangeFill.visible = true;
      rangeRing.visible = true;
    }

    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    if (state.gameOver) return;

    const existing = towerAt(c, r);
    const isBlocked = blocked.has(c + ',' + r);
    const w = gridToWorld(c, r);

    hoverMesh.position.set(w.x, GRASS_TOP + 0.4, w.z);
    if (existing) {
      hoverMesh.material.color.setHex(0xffd54f);
      hoverMesh.visible = true;
    } else if (isBlocked) {
      hoverMesh.material.color.setHex(0xff5252);
      hoverMesh.visible = true;
    } else if (state.selectedType) {
      const canAfford = state.gold >= TOWER_TYPES[state.selectedType].cost;
      hoverMesh.material.color.setHex(canAfford ? 0x66bb6a : 0xff5252);
      hoverMesh.visible = true;

      const b = TOWER_TYPES[state.selectedType];
      rangeFill.position.set(w.x, GRASS_TOP + 0.6, w.z);
      rangeRing.position.set(w.x, GRASS_TOP + 0.6, w.z);
      rangeFill.scale.setScalar(b.range);
      rangeRing.scale.setScalar(b.range);
      rangeFill.visible = true;
      rangeRing.visible = true;

      updateGhost();
    } else {
      hoverMesh.material.color.setHex(0xffffff);
      hoverMesh.visible = true;
    }
    hoverMesh.material.opacity = 0.35;
  }

  /* ==================== UI ==================== */
  function updateStatsUI() {
    el.lives.textContent = state.lives;
    el.gold.textContent = state.gold;
    el.wave.textContent = state.wave;
    el.score.textContent = state.score;
    el.best.textContent = state.best;

    el.startWave.disabled = state.waveActive || state.gameOver;
    el.startWave.textContent = state.waveActive
      ? 'Волна идёт...'
      : 'Начать волну ' + (state.wave + 1);

    el.speedBtn.textContent = 'Скорость: x' + state.speed;
    el.pauseBtn.textContent = state.paused ? 'Продолжить' : 'Пауза';
    el.muteBtn.textContent = state.muted ? '🔇 Звук: выкл' : '🔊 Звук: вкл';
  }

  /* ==================== Игровой цикл ==================== */
  let lastTime = 0;
  let hoverDirty = false;

  function loop(ts) {
    if (!lastTime) lastTime = ts;
    let dt = (ts - lastTime) / 1000;
    lastTime = ts;
    dt = Math.min(dt, 0.05);

    if (!state.paused && !state.gameOver) {
      let step = dt * state.speed;
      const MAX_STEP = 0.033;
      while (step > 0) {
        const s = Math.min(step, MAX_STEP);
        update(s);
        step -= s;
      }
    }

    if (hoverDirty) {
      updateHoverVisuals();
      hoverDirty = false;
    }

    // Плавное следование камеры к целевому виду
    const camLerp = Math.min(1, dt * 6);
    let dTheta = camTarget.theta - cam.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    cam.theta += dTheta * camLerp;
    cam.phi += (camTarget.phi - cam.phi) * camLerp;
    cam.dist += (camTarget.dist - cam.dist) * camLerp;

    const prevViewSize = viewSize;
    viewSize += (camTarget.viewSize - viewSize) * camLerp;
    if (Math.abs(viewSize - prevViewSize) > 0.005) updateProjection();

    updateCamera();

    // Тряска камеры (после установки канонической позиции)
    if (state.shake.time > 0) {
      const k = state.shake.time / 0.22;
      const mag = state.shake.mag * k * 0.6;
      camera.position.x += (Math.random() - 0.5) * mag;
      camera.position.y += (Math.random() - 0.5) * mag;
      camera.position.z += (Math.random() - 0.5) * mag;
    }

    renderer.render(scene, camera);

    updateStatsUI();
    refreshShop();

    requestAnimationFrame(loop);
  }

  /* ==================== Game over ==================== */
  function gameOver() {
    if (state.gameOver) return;
    state.gameOver = true;
    state.waveActive = false;
    sfx('gameOver');

    if (state.score > loadBest()) {
      state.best = state.score;
      saveBest(state.best);
      state.newRecord = true;
    }

    el.finalScore.textContent = state.score;
    el.finalBest.textContent = state.best;
    el.newRecord.classList.toggle('hidden', !state.newRecord);
    el.overlay.classList.remove('hidden');
    refreshShop();
    refreshInfo();
  }

  /* ==================== Сброс ==================== */
  function resetGame() {
    state.enemies.forEach(function (e) {
      scene.remove(e.mesh);
      disposeObj(e.mesh);
    });
    state.towers.forEach(function (t) {
      scene.remove(t.mesh);
      disposeObj(t.mesh);
    });
    state.projectiles.forEach(function (p) {
      scene.remove(p.mesh);
      p.mesh.material.dispose();
    });
    state.particles.forEach(function (p) { scene.remove(p.mesh); });
    state.rings.forEach(function (r) {
      scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    });
    state.damageNumbers.forEach(function (d) {
      scene.remove(d.sprite);
      d.sprite.material.map.dispose();
      d.sprite.material.dispose();
    });

    state.gold = 150;
    state.lives = 20;
    state.score = 0;
    state.wave = 0;
    state.enemies = [];
    state.towers = [];
    state.projectiles = [];
    state.particles = [];
    state.rings = [];
    state.damageNumbers = [];
    state.spawnQueue = [];
    state.spawnTimer = 0;
    state.waveActive = false;
    state.selectedType = 'arrow';
    state.selectedTower = null;
    state.paused = false;
    state.speed = 1;
    state.gameOver = false;
    state.newRecord = false;
    state.shake = { time: 0, mag: 0 };

    el.overlay.classList.add('hidden');
    refreshShop();
    refreshInfo();
    updateStatsUI();
  }

  /* ==================== Ввод ==================== */
  let mouseDownInfo = null;
  let dragging = null;

  renderer.domElement.addEventListener('pointerdown', function (e) {
    if (e.button === 0) {
      mouseDownInfo = { x: e.clientX, y: e.clientY };
      updateMouseFromEvent(e);
      hoverDirty = true;
    } else if (e.button === 1 || e.button === 2) {
      dragging = { lastX: e.clientX, lastY: e.clientY, btn: e.button };
      try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    }
  });

  renderer.domElement.addEventListener('pointermove', function (e) {
    if (dragging) {
      const dx = e.clientX - dragging.lastX;
      const dy = e.clientY - dragging.lastY;
      cam.theta -= dx * 0.008;
      cam.phi = Math.max(0.12, Math.min(Math.PI / 2.15, cam.phi + dy * 0.006));
      camTarget.theta = cam.theta;
      camTarget.phi = cam.phi;
      clearViewActive();
      updateCamera();
    } else {
      updateMouseFromEvent(e);
      hoverDirty = true;
    }
  });

  renderer.domElement.addEventListener('pointerup', function (e) {
    if (dragging && (e.button === 1 || e.button === 2)) {
      dragging = null;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    if (mouseDownInfo && e.button === 0) {
      const moved = Math.hypot(e.clientX - mouseDownInfo.x, e.clientY - mouseDownInfo.y);
      const info = mouseDownInfo;
      mouseDownInfo = null;
      if (moved < 6) {
        handleClick(info, e);
      }
    }
  });

  renderer.domElement.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  renderer.domElement.addEventListener('wheel', function (e) {
    e.preventDefault();
    const newSize = Math.max(180, Math.min(900, camTarget.viewSize * (1 + e.deltaY * 0.001)));
    camTarget.viewSize = newSize;
    clearViewActive();
  }, {passive: false});

  function handleClick(downInfo, upEvent) {
    if (state.gameOver) return;
    getAudio();

    updateMouseFromEvent(upEvent);

    const c = state.mouse.c, r = state.mouse.r;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;

    const existing = towerAt(c, r);
    if (existing) {
      state.selectedTower = existing;
      state.selectedType = null;
      refreshShop();
      refreshInfo();
      hoverDirty = true;
      return;
    }

    if (blocked.has(c + ',' + r)) {
      showToast('Здесь проходит дорога');
      sfx('error');
      return;
    }

    if (!state.selectedType) {
      state.selectedTower = null;
      refreshInfo();
      hoverDirty = true;
      return;
    }

    const type = state.selectedType;
    const cost = TOWER_TYPES[type].cost;
    if (state.gold < cost) {
      showToast('Недостаточно золота');
      sfx('error');
      return;
    }

    state.gold -= cost;
    const w = gridToWorld(c, r);
    const mesh = createTowerMesh(type, false);
    mesh.position.set(w.x, GRASS_TOP, w.z);
    scene.add(mesh);

    const tower = {
      c: c, r: r,
      worldX: w.x, worldZ: w.z,
      type: type,
      level: 1,
      cooldown: 0,
      recoil: 0,
      invested: cost,
      mesh: mesh
    };
    updateTowerDots(tower);
    state.towers.push(tower);
    state.selectedTower = tower;
    sfx('place');
    spawnBurst(w.x, 6, w.z, PARTICLE_MATS.green, 12, 60);
    addRing(w.x, GRASS_TOP, w.z, 26, 0x66bb6a);
    refreshInfo();
    refreshShop();
    hoverDirty = true;
  }

  /* ==================== Кнопки/клавиши ==================== */
  el.startWave.addEventListener('click', function () {
    getAudio();
    startWave();
  });

  el.speedBtn.addEventListener('click', function () {
    const order = [1, 2, 3];
    const idx = order.indexOf(state.speed);
    state.speed = order[(idx + 1) % order.length];
    updateStatsUI();
  });

  el.pauseBtn.addEventListener('click', function () {
    if (state.gameOver) return;
    state.paused = !state.paused;
    updateStatsUI();
  });

  el.muteBtn.addEventListener('click', function () {
    state.muted = !state.muted;
    saveMuted(state.muted);
    updateStatsUI();
    if (!state.muted) sfx('place');
  });

  el.resetBtn.addEventListener('click', function () {
    resetGame();
    showToast('Игра сброшена');
  });

  el.restartBtn.addEventListener('click', function () {
    resetGame();
  });

  // Кнопки предустановленных видов
  if (el.views) {
    const viewBtns = el.views.querySelectorAll('.view-btn');
    for (let i = 0; i < viewBtns.length; i++) {
      viewBtns[i].addEventListener('click', function () {
        setView(viewBtns[i].dataset.view);
      });
    }
  }

  document.addEventListener('keydown', function (e) {
    const k = e.key;
    if (e.code === 'Space') {
      e.preventDefault();
      getAudio();
      startWave();
    } else if (k === 'p' || k === 'P' || k === 'з' || k === 'З') {
      if (!state.gameOver) {
        state.paused = !state.paused;
        updateStatsUI();
      }
    } else if (k === '1') {
      state.selectedType = state.selectedType === 'arrow' ? null : 'arrow';
      state.selectedTower = null;
      refreshShop(); refreshInfo(); hoverDirty = true;
    } else if (k === '2') {
      state.selectedType = state.selectedType === 'cannon' ? null : 'cannon';
      state.selectedTower = null;
      refreshShop(); refreshInfo(); hoverDirty = true;
    } else if (k === '3') {
      state.selectedType = state.selectedType === 'frost' ? null : 'frost';
      state.selectedTower = null;
      refreshShop(); refreshInfo(); hoverDirty = true;
    } else if (k === 'Escape') {
      state.selectedType = null;
      state.selectedTower = null;
      refreshShop(); refreshInfo(); hoverDirty = true;
    }
    // ----- Обзор камеры -----
    else if (k === 'q' || k === 'Q' || k === 'й' || k === 'Й') {
      camTarget.theta -= 0.25;
      clearViewActive();
    } else if (k === 'e' || k === 'E' || k === 'у' || k === 'У') {
      camTarget.theta += 0.25;
      clearViewActive();
    } else if (k === 'z' || k === 'Z' || k === 'я' || k === 'Я') {
      camTarget.phi = Math.max(0.12, camTarget.phi - 0.12);
      clearViewActive();
    } else if (k === 'x' || k === 'X' || k === 'ч' || k === 'Ч') {
      camTarget.phi = Math.min(Math.PI / 2.15, camTarget.phi + 0.12);
      clearViewActive();
    } else if (k === '+' || k === '=') {
      camTarget.viewSize = Math.max(180, camTarget.viewSize * 0.9);
      clearViewActive();
    } else if (k === '-' || k === '_') {
      camTarget.viewSize = Math.min(900, camTarget.viewSize * 1.1);
      clearViewActive();
    }
  });

  /* ==================== Init ==================== */
  function init() {
    buildBoard();
    buildShop();
    refreshShop();
    refreshInfo();
    updateStatsUI();
    el.best.textContent = state.best;
    requestAnimationFrame(loop);
  }

  init();
})();