(() => {
  "use strict";

  const W = 1280;
  const H = 720;
  const GROUND = 578;
  const GRAVITY = 2600;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("hud");
  const heartsEl = document.getElementById("hearts");
  const scoreEl = document.getElementById("score");
  const waveEl = document.getElementById("wave");
  const comboEl = document.getElementById("combo");
  const comboWrap = document.getElementById("comboWrap");
  const bannerEl = document.getElementById("banner");
  const titleEl = document.getElementById("title");
  const pauseEl = document.getElementById("pause");
  const overEl = document.getElementById("over");
  const overStats = document.getElementById("overStats");
  const touchEl = document.getElementById("touch");

  const assets = {};
  const keys = new Set();
  const mouse = { x: W * 0.7, y: H * 0.4, down: false, rdown: false };
  const touchMove = { left: false, right: false, jump: false };

  let state = "title";
  let last = 0;
  let shake = 0;
  let hitstop = 0;
  let camX = 0;
  let time = 0;
  let bannerTimer = 0;
  let audio;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function loadAssets() {
    const files = {
      hero: "assets/hero.png",
      thug: "assets/thug.png",
      thugWrapped: "assets/thug-wrapped.png",
      gunner: "assets/gunner.png",
      gunnerWrapped: "assets/gunner-wrapped.png",
      city: "assets/city.jpg",
      rooftop: "assets/rooftop.jpg",
      tower: "assets/water-tower.png",
      ac: "assets/ac-unit.png",
      burst: "assets/web-burst.png",
      heart: "assets/heart.png",
    };
    const entries = await Promise.all(
      Object.entries(files).map(async ([k, src]) => [k, await loadImage(src)])
    );
    for (const [k, img] of entries) assets[k] = img;
  }

  /* -------------------- audio -------------------- */
  function makeAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctxA = new AC();
    let musicTimer = null;
    let step = 0;
    const notes = [110, 130.8, 146.8, 164.8, 146.8, 130.8, 98, 110];

    function envGain(duration, peak = 0.08) {
      const g = ctxA.createGain();
      g.gain.setValueAtTime(peak, ctxA.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0008, ctxA.currentTime + duration);
      g.connect(ctxA.destination);
      return g;
    }

    function tone(freq, type, dur, peak) {
      const o = ctxA.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, ctxA.currentTime);
      o.connect(envGain(dur, peak));
      o.start();
      o.stop(ctxA.currentTime + dur);
    }

    function noise(dur, peak, freq = 900) {
      const buffer = ctxA.createBuffer(1, ctxA.sampleRate * dur, ctxA.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctxA.createBufferSource();
      src.buffer = buffer;
      const f = ctxA.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      src.connect(f);
      f.connect(envGain(dur, peak));
      src.start();
    }

    return {
      resume() {
        if (ctxA.state === "suspended") ctxA.resume();
      },
      thwip() {
        tone(520, "sawtooth", 0.12, 0.05);
        const o = ctxA.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(340, ctxA.currentTime);
        o.frequency.exponentialRampToValueAtTime(70, ctxA.currentTime + 0.14);
        o.connect(envGain(0.14, 0.07));
        o.start();
        o.stop(ctxA.currentTime + 0.15);
        noise(0.08, 0.04, 1800);
      },
      wrap() {
        noise(0.16, 0.07, 700);
        tone(180, "square", 0.18, 0.04);
      },
      jump() {
        tone(240, "square", 0.09, 0.04);
      },
      hurt() {
        tone(90, "sawtooth", 0.22, 0.08);
        noise(0.2, 0.06, 400);
      },
      swing() {
        noise(0.1, 0.03, 1200);
        tone(160, "sine", 0.2, 0.03);
      },
      combo() {
        tone(520, "square", 0.08, 0.04);
        tone(780, "square", 0.1, 0.03);
      },
      startMusic() {
        if (musicTimer) return;
        const tick = () => {
          if (state !== "playing") return;
          const n = notes[step % notes.length];
          tone(n, "triangle", 0.28, 0.025);
          if (step % 4 === 0) tone(n / 2, "sine", 0.4, 0.03);
          step++;
        };
        tick();
        musicTimer = setInterval(tick, 320);
      },
      stopMusic() {
        clearInterval(musicTimer);
        musicTimer = null;
      },
    };
  }

  /* -------------------- world -------------------- */
  const game = {
    score: 0,
    wave: 1,
    combo: 0,
    comboT: 0,
    best: 0,
    spawnQ: [],
    spawnT: 0,
    remaining: 0,
    floaters: [],
    bursts: [],
    webs: [],
    bullets: [],
    enemies: [],
    particles: [],
    props: [],
  };

  const player = {
    x: 240,
    y: GROUND,
    vx: 0,
    vy: 0,
    w: 64,
    h: 156,
    facing: 1,
    hp: 5,
    maxHp: 5,
    invuln: 0,
    onGround: true,
    jumps: 2,
    coyote: 0,
    jumpBuf: 0,
    shootCd: 0,
    swinging: false,
    ax: 0,
    ay: 0,
    rope: 0,
    run: 0,
    shootFlash: 0,
    dead: false,
  };

  function resetPlayer() {
    Object.assign(player, {
      x: 240,
      y: GROUND,
      vx: 0,
      vy: 0,
      facing: 1,
      hp: 5,
      invuln: 0,
      onGround: true,
      jumps: 2,
      coyote: 0,
      jumpBuf: 0,
      shootCd: 0,
      swinging: false,
      run: 0,
      shootFlash: 0,
      dead: false,
    });
  }

  function seedProps() {
    game.props = [];
    for (let i = -2; i < 18; i++) {
      game.props.push({
        kind: "tower",
        x: i * 980 + 420,
        y: GROUND,
        s: 0.9 + (i % 3) * 0.08,
      });
      game.props.push({
        kind: "ac",
        x: i * 980 + 140,
        y: GROUND,
        s: 0.55,
      });
      game.props.push({
        kind: "ac",
        x: i * 980 + 700,
        y: GROUND,
        s: 0.45,
      });
    }
  }

  function startGame() {
    game.score = 0;
    game.wave = 1;
    game.combo = 0;
    game.comboT = 0;
    game.floaters = [];
    game.bursts = [];
    game.webs = [];
    game.bullets = [];
    game.enemies = [];
    game.particles = [];
    seedProps();
    resetPlayer();
    camX = player.x - 420;
    state = "playing";
    titleEl.classList.add("hidden");
    overEl.classList.add("hidden");
    pauseEl.classList.add("hidden");
    hud.classList.remove("hidden");
    queueWave(1);
    renderHearts();
    updateHud();
    audio.resume();
    audio.startMusic();
    showBanner("WAVE 1");
  }

  function queueWave(n) {
    game.spawnQ = [];
    const thugs = 3 + n;
    const guns = Math.max(0, n - 1);
    for (let i = 0; i < thugs; i++) game.spawnQ.push("thug");
    for (let i = 0; i < guns; i++) game.spawnQ.push("gunner");
    // shuffle
    for (let i = game.spawnQ.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [game.spawnQ[i], game.spawnQ[j]] = [game.spawnQ[j], game.spawnQ[i]];
    }
    game.remaining = game.spawnQ.length;
    game.spawnT = 0.4;
    waveEl.textContent = String(n);
  }

  let spawnSide = 1;
  function spawnEnemy(type) {
    const side = spawnSide;
    spawnSide *= -1;
    const x = camX + (side < 0 ? -80 : W + 80);
    const spec =
      type === "gunner"
        ? { w: 92, h: 150, speed: 95, hp: 1, range: 360 }
        : { w: 88, h: 148, speed: 130 + game.wave * 8, hp: 1, range: 58 };
    game.enemies.push({
      type,
      x,
      y: GROUND,
      vx: 0,
      vy: 0,
      w: spec.w,
      h: spec.h,
      speed: spec.speed,
      hp: spec.hp,
      range: spec.range,
      facing: side < 0 ? 1 : -1,
      state: "alive",
      wrapT: 0,
      atkCd: rand(0.4, 1.2),
      shootCd: rand(0.6, 1.6),
      bob: Math.random() * 10,
    });
  }

  function renderHearts() {
    heartsEl.innerHTML = "";
    for (let i = 0; i < player.maxHp; i++) {
      const img = document.createElement("img");
      img.src = "assets/heart.png";
      img.alt = "";
      if (i >= player.hp) img.classList.add("gone");
      heartsEl.appendChild(img);
    }
  }

  function updateHud() {
    scoreEl.textContent = String(game.score);
    comboEl.textContent = `x${game.combo}`;
    comboWrap.classList.toggle("show", game.combo >= 1);
  }

  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.classList.remove("hidden");
    bannerEl.style.animation = "none";
    void bannerEl.offsetWidth;
    bannerEl.style.animation = "";
    bannerTimer = 1.4;
  }

  function floater(x, y, text, color) {
    game.floaters.push({ x, y, text, color, t: 0, life: 0.8 });
  }

  function burst(x, y, s = 1) {
    game.bursts.push({ x, y, t: 0, s });
    for (let i = 0; i < 10; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(80, 280);
      game.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.25, 0.55),
        t: 0,
        c: Math.random() < 0.5 ? "#fff" : "#b9f3ff",
      });
    }
  }

  /* -------------------- input -------------------- */
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") {
      player.jumpBuf = 0.14;
    }
    if (e.code === "Escape" && state === "playing") pause();
    else if (e.code === "Escape" && state === "paused") resume();
    if ((e.code === "Enter" || e.code === "Space") && state === "title") startGame();
    if ((e.code === "Enter" || e.code === "Space") && state === "gameover") startGame();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect(); // canvas, not the frame
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  }

  canvas.addEventListener("mousemove", (e) => {
    const p = canvasPoint(e);
    mouse.x = p.x;
    mouse.y = p.y;
  });
  canvas.addEventListener("mousedown", (e) => {
    const p = canvasPoint(e);
    mouse.x = p.x;
    mouse.y = p.y;
    if (e.button === 0) {
      mouse.down = true;
      if (state === "playing") tryShoot();
    }
    if (e.button === 2) {
      mouse.rdown = true;
      if (state === "playing") trySwing();
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouse.down = false;
    if (e.button === 2) {
      mouse.rdown = false;
      if (player.swinging) releaseSwing(false);
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  document.getElementById("playBtn").addEventListener("click", startGame);
  document.getElementById("retryBtn").addEventListener("click", startGame);
  document.getElementById("resumeBtn").addEventListener("click", resume);
  pauseEl.addEventListener("click", (e) => {
    if (e.target === pauseEl) resume();
  });

  function isTouch() {
    return matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || window.innerWidth < 720;
  }
  if (isTouch()) touchEl.classList.remove("hidden");
  touchEl.addEventListener("pointerdown", (e) => {
    const dir = e.target.closest(".pad")?.dataset.dir;
    if (!dir) return;
    e.preventDefault();
    if (dir === "left") touchMove.left = true;
    if (dir === "right") touchMove.right = true;
    if (dir === "jump") {
      touchMove.jump = true;
      player.jumpBuf = 0.14;
    }
  });
  window.addEventListener("pointerup", () => {
    touchMove.left = touchMove.right = touchMove.jump = false;
  });

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (state !== "playing") return;
      const t = e.changedTouches[0];
      const p = canvasPoint(t);
      mouse.x = p.x;
      mouse.y = p.y;
      mouse.down = true;
      tryShoot();
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchmove",
    (e) => {
      const t = e.changedTouches[0];
      const p = canvasPoint(t);
      mouse.x = p.x;
      mouse.y = p.y;
    },
    { passive: true }
  );
  canvas.addEventListener("touchend", () => {
    mouse.down = false;
  });

  function pause() {
    if (state !== "playing") return;
    state = "paused";
    pauseEl.classList.remove("hidden");
  }
  function resume() {
    if (state !== "paused") return;
    state = "playing";
    pauseEl.classList.add("hidden");
    last = performance.now();
  }

  /* -------------------- combat / move -------------------- */
  function worldMouse() {
    return { x: mouse.x + camX, y: mouse.y };
  }

  function wrist() {
    return {
      x: player.x + player.facing * 18,
      y: player.y - player.h * 0.55,
    };
  }

  function aimPoint() {
    const w = worldMouse();
    let best = null;
    let bestScore = 0.92;
    const o = wrist();
    const aimX = w.x - o.x;
    const aimY = w.y - o.y;
    const aimD = Math.hypot(aimX, aimY) || 1;
    const ax = aimX / aimD;
    const ay = aimY / aimD;
    for (const en of game.enemies) {
      if (en.state !== "alive") continue;
      const ex = en.x - o.x;
      const ey = en.y - en.h * 0.55 - o.y;
      const ed = Math.hypot(ex, ey) || 1;
      const dot = (ex / ed) * ax + (ey / ed) * ay;
      if (dot > bestScore && ed < 780) {
        bestScore = dot;
        best = en;
      }
    }
    if (best) return { x: best.x, y: best.y - best.h * 0.55 };
    return w;
  }

  function tryShoot() {
    if (player.dead || player.shootCd > 0 || state !== "playing") return false;
    const w = aimPoint();
    const o = wrist();
    let dx = w.x - o.x;
    let dy = w.y - o.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    player.facing = dx >= 0 ? 1 : -1;
    player.shootCd = 0.14;
    player.shootFlash = 0.12;
    game.webs.push({
      x: o.x,
      y: o.y,
      vx: dx * 1750,
      vy: dy * 1750,
      ox: o.x,
      oy: o.y,
      life: 0.7,
    });
    if (audio) audio.thwip();
    return true;
  }

  function trySwing() {
    if (player.dead) return;
    const w = worldMouse();
    const o = wrist();
    const dx = w.x - o.x;
    const dy = w.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dy > -30 || dist < 80 || dist > 620) return;
    player.swinging = true;
    player.ax = w.x;
    player.ay = clamp(w.y, 40, player.y - 70);
    player.rope = Math.hypot(player.x - player.ax, player.y - player.h * 0.5 - player.ay);
    player.rope = clamp(player.rope, 120, 560);
    player.onGround = false;
    audio.swing();
  }

  function releaseSwing(boost) {
    player.swinging = false;
    if (boost) {
      player.vy -= 220;
      player.vx += player.facing * 80;
    }
  }

  function wantLeft() {
    return keys.has("KeyA") || keys.has("ArrowLeft") || touchMove.left;
  }
  function wantRight() {
    return keys.has("KeyD") || keys.has("ArrowRight") || touchMove.right;
  }

  function hurtPlayer(fromX) {
    if (player.invuln > 0 || player.dead) return;
    player.hp -= 1;
    player.invuln = 1.05;
    player.vx = sign(player.x - fromX) * 320;
    player.vy = -280;
    player.onGround = false;
    if (player.swinging) releaseSwing(false);
    shake = 14;
    audio.hurt();
    renderHearts();
    if (player.hp <= 0) die();
  }

  function die() {
    player.dead = true;
    player.hp = 0;
    player.swinging = false;
    audio.stopMusic();
    setTimeout(() => {
      state = "gameover";
      hud.classList.add("hidden");
      overEl.classList.remove("hidden");
      overStats.textContent = `Score ${game.score}  ·  Wave ${game.wave}  ·  Best combo x${game.best}`;
    }, 650);
  }

  function wrapEnemy(en, web) {
    if (en.state !== "alive") return;
    en.state = "wrapped";
    en.wrapT = 0;
    en.vx = sign(web.vx) * 140;
    en.vy = -240;
    game.remaining = Math.max(0, game.remaining - 1);
    game.combo += 1;
    game.comboT = 2.2;
    game.best = Math.max(game.best, game.combo);
    const pts = 100 * game.combo;
    game.score += pts;
    floater(en.x, en.y - en.h, `+${pts}`, "#ffd84a");
    if (game.combo >= 2) {
      floater(en.x, en.y - en.h - 28, `x${game.combo}`, "#6df0ff");
      audio.combo();
    }
    burst(en.x, en.y - en.h * 0.55, 1.1);
    shake = Math.min(18, shake + 6);
    hitstop = 0.045;
    audio.wrap();
    updateHud();
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;
  }

  /* -------------------- update -------------------- */
  function update(dt) {
    time += dt;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) bannerEl.classList.add("hidden");
    }
    if (hitstop > 0) {
      hitstop -= dt;
      return;
    }
    shake = Math.max(0, shake - dt * 28);

    if (state !== "playing") return;

    player.shootCd = Math.max(0, player.shootCd - dt);
    player.shootFlash = Math.max(0, player.shootFlash - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.coyote = Math.max(0, player.coyote - dt);
    player.jumpBuf = Math.max(0, player.jumpBuf - dt);
    game.comboT -= dt;
    if (game.comboT <= 0) {
      game.combo = 0;
      updateHud();
    }

    // spawn
    if (game.spawnQ.length) {
      game.spawnT -= dt;
      if (game.spawnT <= 0) {
        spawnEnemy(game.spawnQ.shift());
        game.spawnT = Math.max(0.35, 1.05 - game.wave * 0.06);
      }
    } else if (game.remaining <= 0 && game.enemies.every((e) => e.state !== "alive")) {
      game.wave += 1;
      player.hp = Math.min(player.maxHp, player.hp + (game.wave % 3 === 0 ? 1 : 0));
      renderHearts();
      queueWave(game.wave);
      showBanner(`WAVE ${game.wave}`);
    }

    // movement
    const left = wantLeft();
    const right = wantRight();
    const accel = player.onGround ? 2400 : 1600;
    const maxSpd = player.swinging ? 520 : 390;
    if (!player.dead) {
      if (left && !right) player.vx -= accel * dt;
      else if (right && !left) player.vx += accel * dt;
      else if (player.onGround && !player.swinging) player.vx *= Math.pow(0.0015, dt);
      player.vx = clamp(player.vx, -maxSpd, maxSpd);
      if (left && !right) player.facing = -1;
      if (right && !left) player.facing = 1;
      const wm = worldMouse();
      if (Math.abs(wm.x - player.x) > 12) player.facing = wm.x >= player.x ? 1 : -1;
    }

    if (!player.swinging) player.vy += GRAVITY * dt;

    if (!player.dead && player.jumpBuf > 0 && (player.onGround || player.coyote > 0 || player.jumps > 0 || player.swinging)) {
      if (player.swinging) {
        releaseSwing(true);
      }
      const first = player.onGround || player.coyote > 0;
      player.vy = first ? -860 : -720;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuf = 0;
      if (!first) player.jumps -= 1;
      else player.jumps = 1;
      audio.jump();
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (player.swinging) {
      const px = player.x;
      const py = player.y - player.h * 0.5;
      let dx = px - player.ax;
      let dy = py - player.ay;
      let dist = Math.hypot(dx, dy) || 1;
      // slowly reel in
      player.rope = Math.max(110, player.rope - 70 * dt);
      if (dist > player.rope) {
        dx /= dist;
        dy /= dist;
        player.x = player.ax + dx * player.rope;
        player.y = player.ay + dy * player.rope + player.h * 0.5;
        const rvx = player.vx;
        const rvy = player.vy;
        const radial = rvx * dx + rvy * dy;
        if (radial > 0) {
          player.vx -= dx * radial;
          player.vy -= dy * radial;
        }
        // gravity as tangent pull
        player.vy += GRAVITY * dt * 0.55;
      }
      if (!mouse.rdown) releaseSwing(false);
    }

    if (player.y >= GROUND) {
      player.y = GROUND;
      if (player.vy > 0) player.vy = 0;
      if (!player.onGround) player.jumps = 2;
      player.onGround = true;
      player.coyote = 0.1;
      if (player.swinging && player.ay > GROUND - 80) releaseSwing(false);
    } else {
      if (player.onGround) player.coyote = 0.1;
      player.onGround = false;
    }

    if (Math.abs(player.vx) > 30 && player.onGround) player.run += dt * 10;
    else player.run += dt * 2;

    camX = lerp(camX, player.x - W * 0.38, 1 - Math.pow(0.001, dt));
    camX = clamp(camX, player.x - W * 0.7, player.x - W * 0.2);

    // webs
    for (const web of game.webs) {
      web.life -= dt;
      const nx = web.x + web.vx * dt;
      const ny = web.y + web.vy * dt;
      web.vy += 90 * dt;
      let hit = false;
      const steps = 6;
      for (let s = 1; s <= steps && !hit; s++) {
        const t = s / steps;
        const sxw = web.x + (nx - web.x) * t;
        const syw = web.y + (ny - web.y) * t;
        if (syw > GROUND - 4) {
          web.life = 0;
          burst(sxw, GROUND - 10, 0.45);
          hit = true;
          break;
        }
        for (const en of game.enemies) {
          if (en.state !== "alive") continue;
          if (aabb(sxw, syw, 36, 36, en.x, en.y - en.h * 0.5, en.w * 0.85, en.h)) {
            wrapEnemy(en, web);
            web.life = 0;
            hit = true;
            break;
          }
        }
        if (hit) break;
        for (const b of game.bullets) {
          if (b.life <= 0) continue;
          if (Math.hypot(sxw - b.x, syw - b.y) < 28) {
            b.life = 0;
            web.life = 0;
            burst(b.x, b.y, 0.4);
            game.score += 25;
            floater(b.x, b.y, "+25", "#fff");
            updateHud();
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        web.x = nx;
        web.y = ny;
      }
    }
    game.webs = game.webs.filter((w) => w.life > 0);

    // enemies
    for (const en of game.enemies) {
      en.bob += dt * 8;
      if (en.state === "wrapped") {
        en.wrapT += dt;
        en.vy += GRAVITY * dt;
        en.x += en.vx * dt;
        en.y += en.vy * dt;
        continue;
      }
      const dx = player.x - en.x;
      en.facing = dx >= 0 ? 1 : -1;
      const dist = Math.abs(dx);
      // keep thugs from stacking on top of each other
      for (const other of game.enemies) {
        if (other === en || other.state !== "alive") continue;
        const gap = en.x - other.x;
        if (Math.abs(gap) < 70) en.vx += sign(gap || 1) * 40;
      }
      if (en.type === "thug") {
        if (dist > en.range) en.vx = sign(dx) * en.speed;
        else en.vx *= 0.7;
        en.x += en.vx * dt;
        en.atkCd -= dt;
        if (dist < 76 && Math.abs(player.y - en.y) < 80 && en.atkCd <= 0) {
          hurtPlayer(en.x);
          en.atkCd = 1.2;
          en.vx = -en.facing * 260;
        }
        if (Math.abs(player.x - en.x) < 70) {
          en.x = player.x - sign(player.x - en.x || 1) * 70;
        }
      } else {
        const desired = 340;
        if (dist > desired + 40) en.vx = sign(dx) * en.speed;
        else if (dist < desired - 50) en.vx = -sign(dx) * en.speed * 0.9;
        else en.vx *= 0.8;
        en.x += en.vx * dt;
        en.shootCd -= dt;
        if (en.shootCd <= 0 && dist < 720 && Math.abs(player.y - en.y) < 220) {
          const ox = en.x + en.facing * 40;
          const oy = en.y - en.h * 0.62;
          const px = player.x;
          const py = player.y - player.h * 0.5;
          let bx = px - ox;
          let by = py - oy;
          const d = Math.hypot(bx, by) || 1;
          game.bullets.push({
            x: ox,
            y: oy,
            vx: (bx / d) * (340 + game.wave * 12),
            vy: (by / d) * (340 + game.wave * 12),
            life: 2.4,
          });
          en.shootCd = Math.max(0.85, 1.7 - game.wave * 0.08);
        }
      }
    }
    game.enemies = game.enemies.filter((e) => !(e.state === "wrapped" && (e.wrapT > 1.3 || e.y > H + 80)));

    for (const b of game.bullets) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > GROUND - 6) b.life = 0;
      if (
        !player.dead &&
        aabb(b.x, b.y, 14, 14, player.x, player.y - player.h * 0.5, player.w * 0.55, player.h * 0.8)
      ) {
        hurtPlayer(b.x);
        b.life = 0;
        burst(b.x, b.y, 0.35);
      }
    }
    game.bullets = game.bullets.filter((b) => b.life > 0);

    for (const p of game.particles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 400 * dt;
    }
    game.particles = game.particles.filter((p) => p.t < p.life);
    for (const b of game.bursts) b.t += dt;
    game.bursts = game.bursts.filter((b) => b.t < 0.28);
    for (const f of game.floaters) {
      f.t += dt;
      f.y -= 50 * dt;
    }
    game.floaters = game.floaters.filter((f) => f.t < f.life);

    if (mouse.down && player.shootCd <= 0 && !player.dead) tryShoot();
  }

  /* -------------------- draw -------------------- */
  function draw() {
    const sx = (Math.random() - 0.5) * shake;
    const sy = (Math.random() - 0.5) * shake;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // sky / city
    const city = assets.city;
    const parallax = -camX * 0.18;
    const cw = W * 1.15;
    const ch = H * 0.92;
    ctx.drawImage(city, parallax % cw, 0, cw, ch);
    ctx.drawImage(city, (parallax % cw) + cw - 1, 0, cw, ch);
    ctx.drawImage(city, (parallax % cw) - cw + 1, 0, cw, ch);

    // vignette dusk over rooftop
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, "rgba(4,8,18,0)");
    g.addColorStop(0.55, "rgba(4,8,18,0.35)");
    g.addColorStop(1, "rgba(4,8,18,0.7)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-camX + sx, sy);

    drawFloor();
    drawProps();

    for (const en of game.enemies) drawEnemy(en);
    for (const b of game.bullets) drawBullet(b);
    drawPlayer();
    for (const web of game.webs) drawWeb(web);
    if (player.swinging) drawRope();
    for (const b of game.bursts) {
      const k = 1 - b.t / 0.28;
      const s = (70 + 90 * (1 - k)) * b.s;
      ctx.globalAlpha = k;
      ctx.drawImage(assets.burst, b.x - s / 2, b.y - s / 2, s, s);
      ctx.globalAlpha = 1;
    }
    for (const p of game.particles) {
      ctx.globalAlpha = 1 - p.t / p.life;
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      ctx.globalAlpha = 1;
    }
    for (const f of game.floaters) {
      ctx.globalAlpha = 1 - f.t / f.life;
      ctx.fillStyle = f.color;
      ctx.font = "900 22px Nunito, sans-serif";
      ctx.textAlign = "center";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    drawCrosshair();
    if (player.hp <= 2 && state === "playing") {
      ctx.fillStyle = `rgba(227,28,37,${0.08 + 0.08 * Math.sin(time * 8)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawFloor() {
    const rt = assets.rooftop;
    const tile = 220;
    const start = Math.floor(camX / tile) - 1;
    const end = start + Math.ceil(W / tile) + 3;
    for (let i = start; i <= end; i++) {
      ctx.drawImage(rt, i * tile, GROUND - 8, tile + 1, H - GROUND + 20);
    }
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(camX - 40, GROUND - 8, W + 80, H - GROUND + 20);

    // parapet
    ctx.fillStyle = "#3a1e1a";
    ctx.fillRect(camX - 40, GROUND - 18, W + 80, 14);
    const bstart = Math.floor((camX - 40) / 22);
    const bend = bstart + 80;
    for (let i = bstart; i < bend; i++) {
      ctx.fillStyle = i % 2 ? "#6a3128" : "#7a3b2e";
      ctx.fillRect(i * 22, GROUND - 18, 20, 12);
      ctx.strokeStyle = "#24110e";
      ctx.lineWidth = 1;
      ctx.strokeRect(i * 22, GROUND - 18, 20, 12);
    }
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(camX - 40, GROUND - 2, W + 80, 6);
  }

  function drawProps() {
    for (const p of game.props) {
      if (p.x < camX - 220 || p.x > camX + W + 220) continue;
      if (p.kind === "tower") {
        const h = 260 * p.s;
        const w = 120 * p.s;
        ctx.drawImage(assets.tower, p.x - w / 2, p.y - h, w, h);
      } else {
        const w = 110 * p.s;
        const h = 90 * p.s;
        ctx.drawImage(assets.ac, p.x - w / 2, p.y - h + 4, w, h);
      }
    }
  }

  function drawPlayer() {
    const img = assets.hero;
    const bob = player.onGround && Math.abs(player.vx) > 40 ? Math.sin(player.run) * 5 : 0;
    const lean = player.swinging ? 0.25 * player.facing : player.onGround ? 0 : -0.12 * player.facing;
    ctx.save();
    ctx.translate(player.x, player.y - player.h * 0.5 + bob);
    ctx.rotate(lean);
    ctx.scale(player.facing, 1);
    if (player.invuln > 0 && Math.floor(player.invuln * 18) % 2 === 0) ctx.globalAlpha = 0.35;
    if (player.dead) ctx.globalAlpha = 0.4;
    ctx.drawImage(img, -player.w / 2, -player.h / 2, player.w, player.h);
    ctx.restore();
    ctx.globalAlpha = 1;

    if (player.shootFlash > 0) {
      const o = wrist();
      ctx.save();
      ctx.globalAlpha = player.shootFlash / 0.12;
      ctx.fillStyle = "#e8fbff";
      ctx.beginPath();
      ctx.arc(o.x, o.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemy(en) {
    const img =
      en.state === "wrapped"
        ? en.type === "gunner"
          ? assets.gunnerWrapped
          : assets.thugWrapped
        : en.type === "gunner"
          ? assets.gunner
          : assets.thug;
    const bob = en.state === "alive" ? Math.sin(en.bob) * 3 : 0;
    const spin = en.state === "wrapped" ? en.wrapT * 1.5 * en.facing : 0;
    ctx.save();
    ctx.translate(en.x, en.y - en.h * 0.5 + bob);
    ctx.rotate(spin * 0.15);
    ctx.scale(en.facing, 1);
    if (en.state === "wrapped") ctx.globalAlpha = Math.max(0, 1 - en.wrapT / 1.3);
    ctx.drawImage(img, -en.w / 2, -en.h / 2, en.w, en.h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawBullet(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = "#ffb347";
    ctx.shadowColor = "#ff5a1f";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWeb(web) {
    const o = wrist();
    ctx.save();
    ctx.strokeStyle = "rgba(236,250,255,0.9)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    const mx = (o.x + web.x) / 2;
    const my = (o.y + web.y) / 2 + Math.sin(time * 30) * 6;
    ctx.quadraticCurveTo(mx, my, web.x, web.y);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(web.x, web.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRope() {
    const o = wrist();
    ctx.save();
    ctx.strokeStyle = "rgba(230,248,255,0.85)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    const sag = Math.sin(time * 8) * 8;
    ctx.quadraticCurveTo((o.x + player.ax) / 2 + sag, (o.y + player.ay) / 2 + 18, player.ax, player.ay);
    ctx.stroke();
    ctx.fillStyle = "#c9f4ff";
    ctx.beginPath();
    ctx.arc(player.ax, player.ay, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCrosshair() {
    if (state !== "playing") return;
    const x = mouse.x;
    const y = mouse.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.moveTo(-18, 0);
    ctx.lineTo(-6, 0);
    ctx.moveTo(6, 0);
    ctx.lineTo(18, 0);
    ctx.moveTo(0, -18);
    ctx.lineTo(0, -6);
    ctx.moveTo(0, 6);
    ctx.lineTo(0, 18);
    ctx.stroke();
    ctx.fillStyle = "#e31c25";
    ctx.beginPath();
    ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016);
    last = now;
    if (state === "playing" || state === "title" || state === "gameover") update(dt);
    if (state === "title") {
      // idle attract
      time += dt;
      camX = lerp(camX, 80, 0.02);
      player.x = 280;
      player.y = GROUND;
      player.facing = 1;
      player.run += dt * 2;
    }
    draw();
    requestAnimationFrame(loop);
  }

  window.__webshot = {
    shoot(nx, ny) {
      mouse.x = nx * W;
      mouse.y = ny * H;
      return tryShoot();
    },
    dump() {
      return {
        state,
        score: game.score,
        wave: game.wave,
        combo: game.combo,
        camX,
        webs: game.webs.length,
        player: {
          x: player.x,
          y: player.y,
          hp: player.hp,
          dead: player.dead,
          shootCd: player.shootCd,
        },
        enemies: game.enemies.map((e) => ({
          type: e.type,
          x: e.x,
          y: e.y,
          state: e.state,
        })),
      };
    },
  };

  loadAssets()
    .then(() => {
      audio = makeAudio();
      seedProps();
      last = performance.now();
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      console.error(err);
      document.body.innerHTML = "<p style='color:white;padding:24px'>Failed to load game assets.</p>";
    });
})();
