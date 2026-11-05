/* ============================================================
   game.js — Floppy Bird Dual Mode
   Gravity mode:      classic flap against gravity
   Anti-gravity mode: constant speed, tap flips direction
   ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
     CANVAS SETUP (with safety checks)
  ========================================================== */
  var cvs = document.getElementById('game');
  if (!cvs) { return; }
  var ctx = cvs.getContext('2d');
  if (!ctx) { return; }

  /* ==========================================================
     CONSTANTS
  ========================================================== */
  var W = 360;
  var H = 640;
  var GROUND_H = 96;
  var GROUND_Y = H - GROUND_H;

  var BIRD_X = 96;
  var BIRD_R = 13;

  var PIPE_W = 62;
  var PIPE_GAP = 152;
  var PIPE_SPEED = 138;
  var PIPE_SPACING = 200;
  var PIPE_MARGIN = 64;
  var SPAWN_X = W + 20;

  var GRAVITY = 1500;
  var FLAP_V = -430;
  var MAX_FALL = 800;
  var ANTI_SPEED = 215;

  var TAU = Math.PI * 2;

  var STORAGE = {
    gravity: 'floppyBirdBestGravity',
    antigravity: 'floppyBirdBestAnti'
  };

  /* ==========================================================
     STATE
  ========================================================== */
  var dpr = 1;
  var skyCache = {}, pipeCache = {}, capCache = {}, groundCache = {}, birdCache = {};

  var state = 'menu';
  var mode = 'gravity';
  var best = { gravity: 0, antigravity: 0 };

  var bird = { y: H * 0.42, vy: 0, dir: 1, rot: 0, wing: 0 };
  var pipes = [];
  var clouds = [];
  var score = 0;
  var newBest = false;
  var scorePop = 0;
  var shake = 0;
  var groundOffset = 0;
  var overTimer = 0;
  var lastGapY = null;
  var mouseX = -1, mouseY = -1;
  var lastTs = 0;

  var menuCards = [
    { id: 'gravity',     x: 28,  y: 228, w: 144, h: 220 },
    { id: 'antigravity', x: 188, y: 228, w: 144, h: 220 }
  ];
  var overButtons = [
    { id: 'again', x: 60, y: 430, w: 240, h: 50 },
    { id: 'menu',  x: 60, y: 492, w: 240, h: 50 }
  ];

  /* ==========================================================
     RESIZE + CANVAS HELPERS
  ========================================================== */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    cvs.style.width  = Math.floor(W * scale) + 'px';
    cvs.style.height = Math.floor(H * scale) + 'px';
    cvs.width  = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    skyCache = {}; pipeCache = {}; capCache = {}; groundCache = {}; birdCache = {};
  }

  /* ==========================================================
     AUDIO (WebAudio — no external assets)
  ========================================================== */
  var actx = null;

  function ensureAudio() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { actx = new AC(); } catch (e) { actx = null; } }
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (!actx) return;
    try {
      var t0 = actx.currentTime;
      var osc = actx.createOscillator();
      var gain = actx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.07, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) {}
  }

  function sndFlap()  { tone(560, 0.09, 'square',   0.055, 340); }
  function sndScore() { tone(880, 0.07, 'square', 0.05);
                        setTimeout(function () { tone(1320, 0.10, 'square', 0.05); }, 65); }
  function sndHit()   { tone(240, 0.16, 'sawtooth', 0.09, 70); }
  function sndDie()   { setTimeout(function () { tone(320, 0.30, 'triangle', 0.07, 90); }, 90); }
  function sndMode()  { tone(440, 0.06, 'triangle', 0.05);
                        setTimeout(function () { tone(660, 0.08, 'triangle', 0.05); }, 60); }

  function vibrate(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  /* ==========================================================
     UTILITIES
  ========================================================== */
  function getCanvasCoords(e) {
    var rect = cvs.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width  * W,
      y: (e.clientY - rect.top)  / rect.height * H
    };
  }

  function hitTest(btns, x, y) {
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    var nx = Math.max(rx, Math.min(cx, rx + rw));
    var ny = Math.max(ry, Math.min(cy, ry + rh));
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(str, x, y, size, fill, stroke, strokeW) {
    ctx.font = '900 ' + size + 'px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (stroke) {
      ctx.lineWidth = strokeW || 5;
      ctx.strokeStyle = stroke;
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
  }

  function textLeft(str, x, y, size, fill) {
    ctx.font = '900 ' + size + 'px "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
  }

  /* ==========================================================
     BOOT / RESET
  ========================================================== */
  function loadBests() {
    try {
      best.gravity     = parseInt(localStorage.getItem(STORAGE.gravity)     || '0', 10) || 0;
      best.antigravity = parseInt(localStorage.getItem(STORAGE.antigravity) || '0', 10) || 0;
    } catch (e) {
      best = { gravity: 0, antigravity: 0 };
    }
  }

  function saveBest() {
    try { localStorage.setItem(STORAGE[mode], String(best[mode])); } catch (e) {}
  }

  function initClouds() {
    clouds = [];
    for (var i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * W,
        y: 40 + Math.random() * 250,
        s: 0.55 + Math.random() * 0.75,
        sp: 9 + Math.random() * 16
      });
    }
  }

  function initBird() {
    bird = { y: H * 0.42, vy: 0, dir: 1, rot: 0, wing: 0 };
  }

  function resetGame(selectedMode) {
    mode  = selectedMode;
    state = 'ready';
    initBird();
    pipes = [];
    score = 0;
    newBest = false;
    scorePop = 0;
    shake = 0;
    groundOffset = 0;
    overTimer = 0;
    lastGapY = null;
    skyCache = {}; pipeCache = {}; capCache = {}; groundCache = {}; birdCache = {};
  }

  /* ==========================================================
     INPUT
  ========================================================== */
  function handlePress(x, y) {
    ensureAudio();

    if (state === 'menu') {
      var id = hitTest(menuCards, x, y);
      if (id) { sndMode(); resetGame(id); }
      return;
    }

    if (state === 'ready') {
      state = 'playing';
      if (mode === 'gravity') {
        bird.vy = FLAP_V;
      } else {
        bird.dir = -1;
      }
      bird.wing = 0;
      sndFlap();
      return;
    }

    if (state === 'playing') {
      if (mode === 'gravity') {
        bird.vy = FLAP_V;
      } else {
        bird.dir *= -1;
      }
      bird.wing = 0;
      sndFlap();
      return;
    }

    if (state === 'over') {
      var bid = hitTest(overButtons, x, y);
      if (bid === 'again') { resetGame(mode); return; }
      if (bid === 'menu')  { state = 'menu'; return; }
      if (overTimer > 0.7) resetGame(mode);
    }
  }

  window.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = getCanvasCoords(e);
    handlePress(p.x, p.y);
  }, { passive: false });

  window.addEventListener('pointermove', function (e) {
    var p = getCanvasCoords(e);
    mouseX = p.x; mouseY = p.y;
  });

  window.addEventListener('pointerleave', function () { mouseX = -1; mouseY = -1; });
  window.addEventListener('pointercancel', function () { mouseX = -1; mouseY = -1; });

  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;

    if (state === 'menu') {
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault(); sndMode(); resetGame('gravity');
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault(); sndMode(); resetGame('antigravity');
      }
      return;
    }

    if (e.code === 'Space' || e.code === 'ArrowUp' ||
        e.code === 'KeyW'   || e.code === 'Enter') {
      e.preventDefault();
      handlePress(W / 2, H / 2);
    }
  }, { passive: false });

  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) lastTs = 0;
  });

  /* ==========================================================
     GAME LOGIC
  ========================================================== */
  function spawnPipe() {
    var minY = PIPE_MARGIN + PIPE_GAP / 2;
    var maxY = GROUND_Y - PIPE_MARGIN - PIPE_GAP / 2;
    var gy = minY + Math.random() * (maxY - minY);

    if (lastGapY !== null) {
      gy = Math.max(lastGapY - 150, Math.min(lastGapY + 150, gy));
      gy = Math.max(minY, Math.min(maxY, gy));
    }
    lastGapY = gy;
    pipes.push({ x: SPAWN_X, gapY: gy, scored: false });
  }

  function die() {
    if (state !== 'playing') return;
    state = 'over';
    overTimer = 0;
    shake = 12;
    sndHit();
    sndDie();
    vibrate(60);
    if (score > best[mode]) {
      best[mode] = score;
      newBest = true;
      saveBest();
    }
  }

  function update(dt) {
    var now = performance.now() / 1000;

    var cloudMul = (state === 'playing') ? 1.7 : 0.7;
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x -= c.sp * cloudMul * dt;
      if (c.x < -110) { c.x = W + 110; c.y = 40 + Math.random() * 250; }
    }

    if (state !== 'over') groundOffset = (groundOffset + PIPE_SPEED * dt) % 28;
    if (scorePop > 0) scorePop = Math.max(0, scorePop - dt * 4);
    if (shake > 0)    shake    = Math.max(0, shake - dt * 45);

    if (state === 'menu') return;

    if (state === 'ready') {
      bird.y   = H * 0.42 + Math.sin(now * 2.4) * 7;
      bird.rot = Math.sin(now * 2.4) * 0.10;
      bird.wing = (bird.wing + dt * 12) % TAU;
      return;
    }

    if (state === 'over') {
      overTimer += dt;
      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
      bird.y += bird.vy * dt;
      bird.rot = Math.min(Math.PI / 2, bird.rot + dt * 5);
      if (bird.y > GROUND_Y - BIRD_R) { bird.y = GROUND_Y - BIRD_R; bird.vy = 0; }
      return;
    }

    /* ---- PLAYING ---- */
    if (mode === 'gravity') {
      bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL);
      bird.y += bird.vy * dt;
      if (bird.y < BIRD_R + 2) { bird.y = BIRD_R + 2; bird.vy = 0; }
      var targetRot = bird.vy < 0 ? -0.52 : Math.min(Math.PI / 2, bird.vy / 620);
      bird.rot += (targetRot - bird.rot) * Math.min(1, dt * 11);
      bird.wing = (bird.wing + dt * (bird.vy < 0 ? 26 : 13)) % TAU;
    } else {
      bird.vy = bird.dir * ANTI_SPEED;
      bird.y += bird.vy * dt;
      if (bird.y < BIRD_R + 2) bird.y = BIRD_R + 2;
      var targetRot2 = bird.dir < 0 ? -0.55 : 0.65;
      bird.rot += (targetRot2 - bird.rot) * Math.min(1, dt * 11);
      bird.wing = (bird.wing + dt * 20) % TAU;
    }

    if (pipes.length === 0 || pipes[pipes.length - 1].x <= SPAWN_X - PIPE_SPACING) {
      spawnPipe();
    }

    for (var j = pipes.length - 1; j >= 0; j--) {
      var p = pipes[j];
      p.x -= PIPE_SPEED * dt;
      if (!p.scored && BIRD_X - BIRD_R > p.x + PIPE_W) {
        p.scored = true;
        score++;
        scorePop = 1;
        sndScore();
      }
      if (p.x + PIPE_W + 20 < 0) pipes.splice(j, 1);
    }

    for (var k = 0; k < pipes.length; k++) {
      var pp = pipes[k];
      var gapTop = pp.gapY - PIPE_GAP / 2;
      var gapBot = pp.gapY + PIPE_GAP / 2;
      if (circleRect(BIRD_X, bird.y, BIRD_R, pp.x, -60, PIPE_W, gapTop + 60) ||
          circleRect(BIRD_X, bird.y, BIRD_R, pp.x, gapBot, PIPE_W, GROUND_Y - gapBot + 12)) {
        die();
        return;
      }
    }

    if (bird.y + BIRD_R >= GROUND_Y) {
      bird.y = GROUND_Y - BIRD_R;
      die();
    }
  }

  /* ==========================================================
     CACHED GRADIENTS
  ========================================================== */
  function getSkyGradient() {
    var key = (state === 'menu') ? 'menu' : mode;
    if (!skyCache[key]) {
      var cols;
      if (key === 'menu') {
        cols = ['#2d8a9e', '#5ab5c4', '#a0dde0', '#d0f0e8'];
      } else if (key === 'antigravity') {
        cols = ['#3a2358', '#7a4a8a', '#c97aa0', '#f0b88a'];
      } else {
        cols = ['#3fb3c4', '#79cfd8', '#b6e7e2', '#dff5e6'];
      }
      var g = ctx.createLinearGradient(0, -30, 0, GROUND_Y);
      g.addColorStop(0.00, cols[0]);
      g.addColorStop(0.45, cols[1]);
      g.addColorStop(0.80, cols[2]);
      g.addColorStop(1.00, cols[3]);
      skyCache[key] = g;
    }
    return skyCache[key];
  }

  function pipePalette() {
    if (mode === 'antigravity') {
      return {
        stops:    ['#7a2e5a', '#c94a8a', '#e86ab0', '#a8367a', '#5a1e42'],
        stroke:   '#4a1535',
        highlight:'rgba(255, 220, 240, 0.25)'
      };
    }
    return {
      stops:    ['#3d7a1c', '#7ec242', '#aee566', '#5da531', '#2f5c12'],
      stroke:   '#2b5512',
      highlight:'rgba(255, 255, 255, 0.20)'
    };
  }

  function getPipeGradient() {
    if (!pipeCache[mode]) {
      var pal = pipePalette();
      var g = ctx.createLinearGradient(0, 0, PIPE_W, 0);
      g.addColorStop(0.00, pal.stops[0]);
      g.addColorStop(0.16, pal.stops[1]);
      g.addColorStop(0.44, pal.stops[2]);
      g.addColorStop(0.74, pal.stops[3]);
      g.addColorStop(1.00, pal.stops[4]);
      pipeCache[mode] = g;
    }
    return pipeCache[mode];
  }

  function getCapGradient() {
    if (!capCache[mode]) {
      var pal = pipePalette();
      var g = ctx.createLinearGradient(0, 0, PIPE_W + 10, 0);
      g.addColorStop(0.00, pal.stops[0]);
      g.addColorStop(0.16, pal.stops[1]);
      g.addColorStop(0.44, pal.stops[2]);
      g.addColorStop(0.74, pal.stops[3]);
      g.addColorStop(1.00, pal.stops[4]);
      capCache[mode] = g;
    }
    return capCache[mode];
  }

  function getGroundGradient() {
    if (!groundCache[mode]) {
      var anti = mode === 'antigravity';
      var g = ctx.createLinearGradient(0, GROUND_Y, 0, H + 20);
      g.addColorStop(0, anti ? '#d4b8d8' : '#e8dba4');
      g.addColorStop(1, anti ? '#b89cc0' : '#cfb96d');
      groundCache[mode] = g;
    }
    return groundCache[mode];
  }

  function getBirdGradient() {
    if (!birdCache[mode]) {
      var anti = mode === 'antigravity';
      var g = ctx.createLinearGradient(0, -16, 0, 16);
      if (anti) {
        g.addColorStop(0.00, '#f5c0e0');
        g.addColorStop(0.45, '#e88ab8');
        g.addColorStop(1.00, '#c95a92');
      } else {
        g.addColorStop(0.00, '#ffe98a');
        g.addColorStop(0.45, '#ffd23f');
        g.addColorStop(1.00, '#eda62b');
      }
      birdCache[mode] = g;
    }
    return birdCache[mode];
  }

  /* ==========================================================
     RENDER — World
  ========================================================== */
  function drawSky() {
    ctx.fillStyle = getSkyGradient();
    ctx.fillRect(-30, -30, W + 60, GROUND_Y + 40);
  }

  function drawClouds() {
    ctx.fillStyle = mode === 'antigravity'
      ? 'rgba(255, 220, 240, 0.75)'
      : 'rgba(255, 255, 255, 0.78)';
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.s, c.s);
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, TAU);
      ctx.arc(21, -6, 14, 0, TAU);
      ctx.arc(-21, -4, 13, 0, TAU);
      ctx.arc(6, 9, 15, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPipeBody(x, y, w, h) {
    if (h <= 0) return;
    var pal = pipePalette();
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = getPipeGradient();
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = pal.stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(1, 0);     ctx.lineTo(1, h);
    ctx.moveTo(w - 1, 0); ctx.lineTo(w - 1, h);
    ctx.stroke();
    ctx.fillStyle = pal.highlight;
    ctx.fillRect(w * 0.30, 0, 5, h);
    ctx.restore();
  }

  function drawPipeCap(x, y, w, h) {
    var pal = pipePalette();
    var cw = w + 10;
    ctx.save();
    ctx.translate(x - 5, y);
    ctx.fillStyle = getCapGradient();
    roundRect(0, 0, cw, h, 4);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = pal.stroke;
    ctx.stroke();
    ctx.fillStyle = pal.highlight;
    ctx.fillRect(cw * 0.28, 3, 6, h - 6);
    ctx.restore();
  }

  function drawPipes() {
    for (var i = 0; i < pipes.length; i++) {
      var p = pipes[i];
      var gapTop = p.gapY - PIPE_GAP / 2;
      var gapBot = p.gapY + PIPE_GAP / 2;
      drawPipeBody(p.x, -20, PIPE_W, gapTop + 20);
      drawPipeCap(p.x, gapTop - 26, PIPE_W, 26);
      drawPipeBody(p.x, gapBot, PIPE_W, GROUND_Y - gapBot);
      drawPipeCap(p.x, gapBot, PIPE_W, 26);
    }
  }

  function drawGround() {
    var anti = mode === 'antigravity';
    ctx.fillStyle = getGroundGradient();
    ctx.fillRect(-30, GROUND_Y, W + 60, GROUND_H + 40);

    ctx.fillStyle = anti ? '#a86ab0' : '#7ec850';
    ctx.fillRect(-30, GROUND_Y, W + 60, 16);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, GROUND_Y, W, 16);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
    for (var x = -40; x < W + 40; x += 28) {
      var px = x - groundOffset;
      ctx.beginPath();
      ctx.moveTo(px, GROUND_Y);
      ctx.lineTo(px + 14, GROUND_Y);
      ctx.lineTo(px + 8, GROUND_Y + 16);
      ctx.lineTo(px - 6, GROUND_Y + 16);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = anti ? '#7a4a82' : '#4f9a2b';
    ctx.fillRect(-30, GROUND_Y + 16, W + 60, 4);
    ctx.fillStyle = 'rgba(120, 90, 30, 0.14)';
    ctx.fillRect(-30, GROUND_Y + 20, W + 60, 3);
  }

  function drawBird() {
    var anti = mode === 'antigravity';
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.rot);

    /* Tail */
    ctx.fillStyle = anti ? '#c94a8a' : '#f0a52e';
    ctx.strokeStyle = anti ? '#8a2a5a' : '#c47f10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-13, -3);
    ctx.lineTo(-25, -9);
    ctx.lineTo(-23, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* Body */
    ctx.fillStyle = getBirdGradient();
    ctx.strokeStyle = anti ? '#8a2a5a' : '#c47f10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 13, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    /* Belly */
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(-2, 5, 9, 5, 0, 0, TAU);
    ctx.fill();

    /* Wing */
    ctx.save();
    ctx.translate(-4, 1);
    ctx.rotate(Math.sin(bird.wing) * 0.55);
    ctx.fillStyle = anti ? '#fce4f0' : '#fff8dc';
    ctx.strokeStyle = anti ? '#8a2a5a' : '#c47f10';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9.5, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    /* Eye */
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = anti ? '#8a2a5a' : '#c47f10';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(6, -5, 5.2, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1f1f1f';
    ctx.beginPath();
    ctx.arc(7.8, -5, 2.5, 0, TAU);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(8.9, -6.3, 0.9, 0, TAU);
    ctx.fill();

    /* Beak */
    ctx.fillStyle = anti ? '#ff6ba8' : '#ff8c1a';
    ctx.strokeStyle = anti ? '#b83a72' : '#c96a06';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(13, -1.5);
    ctx.lineTo(26, 1.5);
    ctx.lineTo(13, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(13, 2.4);
    ctx.lineTo(24.5, 2.0);
    ctx.strokeStyle = anti ? '#a82a62' : '#b35d05';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();

    /* Direction indicator (anti-gravity only) */
    if (anti && state === 'playing') {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = bird.dir < 0 ? '#7ef0a0' : '#f07e7e';
      var ax = BIRD_X;
      var ay = bird.y + (bird.dir < 0 ? -28 : 28);
      var d  = bird.dir;
      ctx.beginPath();
      ctx.moveTo(ax, ay + d * 6);
      ctx.lineTo(ax - 6, ay);
      ctx.lineTo(ax + 6, ay);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ==========================================================
     RENDER — UI
  ========================================================== */
  function drawMenu() {
    text('FLOPPY', W / 2, 104, 52, '#ffffff', '#1f5a63', 10);
    text('BIRD',   W / 2, 156, 52, '#ffffff', '#1f5a63', 10);
    text('CHOOSE YOUR MODE', W / 2, 198, 14, 'rgba(255, 255, 255, 0.90)', '#1f5a63', 3);

    for (var i = 0; i < menuCards.length; i++) {
      var card = menuCards[i];
      var isGravity = card.id === 'gravity';
      var isHover =
        mouseX >= card.x && mouseX <= card.x + card.w &&
        mouseY >= card.y && mouseY <= card.y + card.h;

      roundRect(card.x, card.y, card.w, card.h, 16);
      ctx.fillStyle = isGravity
        ? (isHover ? '#fff6d0' : '#f7e8bf')
        : (isHover ? '#f5e0ff' : '#eed4f5');
      ctx.fill();
      ctx.lineWidth = isHover ? 4 : 3;
      ctx.strokeStyle = isGravity ? '#c9a25c' : '#a87ab8';
      ctx.stroke();

      roundRect(card.x + 5, card.y + 5, card.w - 10, card.h - 10, 12);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (isGravity) {
        text('GRAVITY', card.x + card.w / 2, card.y + 38, 20, '#a87030');
      } else {
        text('ANTI',    card.x + card.w / 2, card.y + 38, 20, '#8a4a9a');
        text('GRAVITY', card.x + card.w / 2, card.y + 62, 16, '#8a4a9a');
      }

      var iconY = card.y + (isGravity ? 112 : 122);
      ctx.save();
      ctx.translate(card.x + card.w / 2, iconY);
      ctx.scale(0.85, 0.85);

      ctx.fillStyle = isGravity ? '#ffd23f' : '#e88ab8';
      ctx.strokeStyle = isGravity ? '#c47f10' : '#8a2a5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 13, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isGravity ? '#fff8dc' : '#fce4f0';
      ctx.beginPath();
      ctx.ellipse(-4, 1, 9, 6, -0.2, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(6, -5, 5, 0, TAU);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#1f1f1f';
      ctx.beginPath();
      ctx.arc(7.8, -5, 2.3, 0, TAU);
      ctx.fill();

      ctx.fillStyle = isGravity ? '#ff8c1a' : '#ff6ba8';
      ctx.beginPath();
      ctx.moveTo(13, -1.5);
      ctx.lineTo(25, 1.5);
      ctx.lineTo(13, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      if (isGravity) {
        ctx.fillStyle = '#c9a25c';
        ctx.beginPath();
        ctx.moveTo(card.x + card.w / 2, iconY + 38);
        ctx.lineTo(card.x + card.w / 2 - 8, iconY + 26);
        ctx.lineTo(card.x + card.w / 2 + 8, iconY + 26);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = '#a87ab8';
        ctx.beginPath();
        ctx.moveTo(card.x + card.w / 2, iconY - 26);
        ctx.lineTo(card.x + card.w / 2 - 7, iconY - 16);
        ctx.lineTo(card.x + card.w / 2 + 7, iconY - 16);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(card.x + card.w / 2, iconY + 26);
        ctx.lineTo(card.x + card.w / 2 - 7, iconY + 16);
        ctx.lineTo(card.x + card.w / 2 + 7, iconY + 16);
        ctx.closePath();
        ctx.fill();
      }

      var descY = card.y + (isGravity ? 162 : 170);
      if (isGravity) {
        text('Classic flap',    card.x + card.w / 2, descY,      11, '#8a6a2a');
        text('against gravity', card.x + card.w / 2, descY + 14, 11, '#8a6a2a');
      } else {
        text('Tap to flip', card.x + card.w / 2, descY,      11, '#7a4a8a');
        text('direction',   card.x + card.w / 2, descY + 14, 11, '#7a4a8a');
      }

      var bestVal = isGravity ? best.gravity : best.antigravity;
      text('BEST ' + bestVal,
        card.x + card.w / 2, card.y + card.h - 16, 12,
        isGravity ? '#a87030' : '#8a4a9a');

      ctx.globalAlpha = 0.35;
      text(String(i + 1), card.x + 12, card.y + 12, 11,
        isGravity ? '#a87030' : '#8a4a9a');
      ctx.globalAlpha = 1;
    }

    text('Press 1 or 2 to select', W / 2, 486, 12,
      'rgba(255, 255, 255, 0.75)', '#1f5a63', 3);
  }

  function drawHUD() {
    var pop = 1 + scorePop * 0.42;
    ctx.save();
    ctx.translate(W / 2, 86);
    ctx.scale(pop, pop);
    text(String(score), 0, 0, 50, '#ffffff', '#265a63', 9);
    ctx.restore();

    var isG = mode === 'gravity';
    ctx.save();
    ctx.globalAlpha = 0.78;
    roundRect(10, 12, isG ? 86 : 104, 24, 8);
    ctx.fillStyle = isG
      ? 'rgba(60, 120, 30, 0.75)'
      : 'rgba(120, 50, 130, 0.75)';
    ctx.fill();
    textLeft(isG ? 'GRAVITY' : 'ANTI-G', 18, 24, 11, '#fff');
    ctx.restore();
  }

  function drawReadyUI() {
    text('TAP  /  SPACE', W / 2, 468, 21, '#ffffff', '#1f5a63', 6);
    text('BEST  ' + best[mode], W / 2, 516, 16, '#ffffff', '#1f5a63', 4.5);
    if (mode === 'antigravity') {
      text('EACH TAP FLIPS DIRECTION', W / 2, 420, 12,
        'rgba(255, 255, 255, 0.92)', '#5a2a6a', 3.5);
    }
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(9, 24, 32, 0.50)';
    ctx.fillRect(0, 0, W, H);

    var cw = 282, ch = 240;
    var cx = (W - cw) / 2;
    var cy = 170;

    roundRect(cx, cy, cw, ch, 20);
    ctx.fillStyle = '#f7e8bf';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#c9a25c';
    ctx.stroke();

    roundRect(cx + 6, cy + 6, cw - 12, ch - 12, 15);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    text('GAME OVER', W / 2, cy + 44, 30, '#e2603c', '#8a3b1e', 6);

    ctx.beginPath();
    ctx.moveTo(cx + 30, cy + 76);
    ctx.lineTo(cx + cw - 30, cy + 76);
    ctx.strokeStyle = 'rgba(160, 120, 60, 0.40)';
    ctx.lineWidth = 2;
    ctx.stroke();

    text('SCORE', cx + cw * 0.28, cy + 104, 15, '#96742f');
    text('BEST',  cx + cw * 0.72, cy + 104, 15, '#96742f');
    text(String(score),      cx + cw * 0.28, cy + 140, 34, '#5a3f14');
    text(String(best[mode]), cx + cw * 0.72, cy + 140, 34, '#5a3f14');

    if (newBest) {
      var b = 0.6 + 0.4 * Math.sin(performance.now() / 180);
      ctx.globalAlpha = b;
      text('NEW!', cx + cw * 0.72, cy + 172, 15, '#e2603c', '#8a3b1e', 3.5);
      ctx.globalAlpha = 1;
    }

    for (var i = 0; i < overButtons.length; i++) {
      var btn = overButtons[i];
      var isHover =
        mouseX >= btn.x && mouseX <= btn.x + btn.w &&
        mouseY >= btn.y && mouseY <= btn.y + btn.h;
      var isPrimary = btn.id === 'again';

      roundRect(btn.x, btn.y, btn.w, btn.h, 12);
      ctx.fillStyle = isPrimary
        ? (isHover ? '#ffd86a' : '#ffc83a')
        : (isHover ? '#ffffff' : '#f0e8d0');
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isPrimary ? '#c9a25c' : '#b8a888';
      ctx.stroke();

      text(
        isPrimary ? 'PLAY AGAIN' : 'CHANGE MODE',
        btn.x + btn.w / 2, btn.y + btn.h / 2 + 1, 16,
        isPrimary ? '#6a4a10' : '#6a5a3a'
      );
    }
  }

  function render() {
    /* Always paint the whole canvas first — guarantees no white/black gaps */
    ctx.fillStyle = '#0d1a22';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0.2) {
      ctx.translate(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake
      );
    }

    drawSky();
    drawClouds();
    if (state !== 'menu') drawPipes();
    drawGround();
    if (state !== 'menu') drawBird();

    ctx.restore();

    if (state === 'menu') {
      drawMenu();
    } else if (state === 'ready') {
      drawHUD();
      drawReadyUI();
    } else if (state === 'playing') {
      drawHUD();
    } else if (state === 'over') {
      drawHUD();
      drawGameOver();
    }
  }

  /* ==========================================================
     MAIN LOOP (with error guard)
  ========================================================== */
  var errored = false;

  function loop(ts) {
    if (errored) return;

    try {
      if (!lastTs) lastTs = ts;
      var dt = (ts - lastTs) / 1000;
      lastTs = ts;
      if (dt > 1 / 30) dt = 1 / 30;
      if (dt < 0) dt = 0;

      update(dt);
      render();
    } catch (e) {
      errored = true;
      try {
        ctx.fillStyle = '#0d1a22';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ff6666';
        ctx.font = '600 12px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        var msg = String(e && e.message ? e.message : e);
        var lines = msg.match(/.{1,44}/g) || [msg];
        for (var i = 0; i < lines.length && i < 6; i++) {
          ctx.fillText(lines[i], 12, 12 + i * 16);
        }
      } catch (e2) {}
      if (window.console) console.error(e);
      return;
    }

    requestAnimationFrame(loop);
  }

  /* ==========================================================
     BOOT
  ========================================================== */
  try {
    resize();
    loadBests();
    initClouds();
    initBird();
    pipes = [];
    score = 0;
    newBest = false;
    scorePop = 0;
    shake = 0;
    groundOffset = 0;
    overTimer = 0;
    lastGapY = null;
    state = 'menu';

    /* Draw one frame immediately so something is visible right away */
    render();

    requestAnimationFrame(loop);
  } catch (bootErr) {
    try {
      ctx.fillStyle = '#0d1a22';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff6666';
      ctx.font = '600 12px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      var m = String(bootErr && bootErr.message ? bootErr.message : bootErr);
      var ls = m.match(/.{1,44}/g) || [m];
      for (var i = 0; i < ls.length && i < 6; i++) {
        ctx.fillText(ls[i], 12, 12 + i * 16);
      }
    } catch (e2) {}
    if (window.console) console.error(bootErr);
  }

})();