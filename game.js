/* ============================================================
   SHADOW SPRINT — game.js
   COMPLETE GAME — Steps 9-23:
   Endless ground, obstacles, collision, coins, score,
   increasing speed, power-ups, Web Audio sound & music,
   game over, high score, mobile responsive, optimized.
============================================================ */

'use strict';

/* ============================================================
   1. CANVAS & CONTEXT
============================================================ */
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();

window.addEventListener('resize', () => {
  resizeCanvas();
  calculateLayout();
  if (player) player.x = layout.laneCenterX[player.lane];
  initStars();
  initCityscape();
  if (gameState !== STATE.PLAYING) idleLoop();
});

/* ============================================================
   2. STATE MACHINE
============================================================ */
const STATE = { START: 'START', PLAYING: 'PLAYING', PAUSED: 'PAUSED', GAMEOVER: 'GAMEOVER' };
let gameState = STATE.START;

/* ============================================================
   3. CONFIG
============================================================ */
const CONFIG = {
  initialSpeed:      9,
  maxSpeed:          28,
  speedIncrement:    0.003,

  numLanes:          3,

  playerWidth:       38,
  playerHeight:      64,
  jumpForce:        -16,
  gravity:           0.65,
  slideHeight:       30,
  slideDuration:     45,
  swipeThreshold:    40,

  coinPoints:        10,
  groundHeight:      110,
  numStars:          180,
  numCityBuildings:  14,

  // Obstacle spawn: every N frames (shrinks with speed)
  obstacleBaseFreq:  120,
  obstacleMinFreq:   45,

  // Coin spawn
  coinBaseFreq:      70,
  coinMinFreq:       30,
  coinSize:          14,   // radius * 2 of each coin

  // Power-up spawn (every ~600 frames)
  powerupFreq:       600,

  // Collision forgiveness (px shaved off hit box)
  collisionMargin:   10,
};

/* ============================================================
   4. GAME DATA
============================================================ */
let gameData = {
  score:          0,
  highScore:      0,
  speed:          CONFIG.initialSpeed,
  frameCount:     0,
  animFrameId:    null,
  lastObstFrame:  0,
  lastCoinFrame:  0,
  lastPowerFrame: 0,
  coins:          0,   // total coins this run
};

/* ============================================================
   5. LAYOUT
============================================================ */
let layout = { groundY: 0, laneWidth: 0, laneCenterX: [] };

function calculateLayout() {
  layout.groundY   = canvas.height - CONFIG.groundHeight;
  layout.laneWidth = canvas.width  / CONFIG.numLanes;
  layout.laneCenterX = [];
  for (let i = 0; i < CONFIG.numLanes; i++) {
    layout.laneCenterX.push(layout.laneWidth * i + layout.laneWidth / 2);
  }
}
calculateLayout();

/* ============================================================
   6. WEB AUDIO — Enhanced Sound Engine
   Helpers: _osc (sweep), _bell (ADSR decay), _noise (filtered burst)
============================================================ */
let audioCtx   = null;
let masterGain = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.72;
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

/* ── Oscillator with exponential pitch sweep + volume fade ── */
function _osc(ac, dest, freq, type, vol, dur, pitchEnd) {
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain); gain.connect(dest);
  osc.type = type;
  osc.frequency.value = freq;
  if (pitchEnd) osc.frequency.exponentialRampToValueAtTime(pitchEnd, ac.currentTime + dur);
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.start(); osc.stop(ac.currentTime + dur + 0.02);
}

/* ── Bell: instant attack, smooth exponential tail ── */
function _bell(ac, dest, freq, vol, sustain) {
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain); gain.connect(dest);
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = ac.currentTime;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.setTargetAtTime(0.0001, t + 0.005, sustain * 0.35);
  osc.start(t); osc.stop(t + sustain + 0.06);
}

/* ── Filtered white-noise burst ── */
function _noise(ac, dest, vol, dur, filterFreq, filterType) {
  const len  = Math.ceil(ac.sampleRate * dur);
  const buf  = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src    = ac.createBufferSource();
  src.buffer   = buf;
  const filter = ac.createBiquadFilter();
  filter.type  = filterType || 'lowpass';
  filter.frequency.value = filterFreq || 2000;
  const gain   = ac.createGain();
  src.connect(filter); filter.connect(gain); gain.connect(dest);
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  src.start(); src.stop(ac.currentTime + dur + 0.02);
}

/* ── Sound Effects ── */
const SFX = {
  jump: () => {
    try {
      const ac = getAudioCtx();
      _osc(ac, masterGain,  200, 'sine',     0.22, 0.20, 560);  // rising sweep
      _osc(ac, masterGain,  390, 'triangle', 0.10, 0.16, 820);  // harmonic
      _noise(ac, masterGain, 0.04, 0.12, 900);                   // air whoosh
    } catch(e) {}
  },
  slide: () => {
    try {
      const ac = getAudioCtx();
      _osc(ac, masterGain,  560, 'sawtooth', 0.16, 0.18, 120);  // downward sweep
      _noise(ac, masterGain, 0.06, 0.16, 1400);
    } catch(e) {}
  },
  coin: () => {
    try {
      const ac = getAudioCtx();
      _bell(ac, masterGain, 1047, 0.24, 0.18);                   // C6 — first note
      setTimeout(() => {
        try {
          _bell(ac, masterGain, 1319, 0.24, 0.26);               // E6 — second note
          _bell(ac, masterGain, 2638, 0.07, 0.20);               // E7 shimmer
        } catch(e) {}
      }, 95);
    } catch(e) {}
  },
  hit: () => {
    try {
      const ac = getAudioCtx();
      _osc(ac, masterGain,  200, 'sine',     0.38, 0.30, 30);   // heavy sub thud
      _osc(ac, masterGain,  130, 'sawtooth', 0.20, 0.28, 40);   // crunch layer
      _noise(ac, masterGain, 0.22, 0.32, 4000);                  // body impact
      _noise(ac, masterGain, 0.12, 0.08, 12000);                 // high crack
    } catch(e) {}
  },
  powerup: () => {
    try {
      const ac = getAudioCtx();
      [330, 415, 523, 659, 831, 1047].forEach((f, i) => {
        setTimeout(() => {
          try {
            _bell(ac, masterGain, f,     0.18, 0.30);
            _bell(ac, masterGain, f * 2, 0.05, 0.22);
          } catch(e) {}
        }, i * 62);
      });
    } catch(e) {}
  },
  shield: () => {
    try {
      const ac = getAudioCtx();
      _bell(ac, masterGain,  880, 0.22, 0.45);                   // metallic ping
      _bell(ac, masterGain, 1320, 0.10, 0.38);                   // harmonic
      _osc(ac, masterGain,  2000, 'sine', 0.05, 0.26, 3500);     // shimmer sweep
    } catch(e) {}
  },
};

/* ============================================================
   7. BACKGROUND MUSIC — Dynamic 5-track synthesized loop
   Master clock: 120ms = 16th note @ 125 BPM
   Tracks: kick · snare · hi-hat · bass · melody · chord stabs
============================================================ */
let musicClockId = null;
let musicEnabled = true;
let _mBeat       = 0;   // 16th-note counter
let _mMelStep    = 0;

// D-minor pentatonic feel: dark, fast, energetic
const _BASS_NOTES = [73, 82, 87, 98, 65, 82, 98, 87];
const _MEL_NOTES  = [294, 330, 392, 440, 494, 523, 587, 659, 784, 880];
const _CHORDS     = [
  [147, 175, 220],   // Dm
  [131, 165, 196],   // Cm
  [117, 147, 175],   // Bb
  [131, 165, 220],   // Gm
];

function startMusic() {
  if (!musicEnabled) return;
  stopMusic();
  _mBeat    = 0;
  _mMelStep = 0;

  musicClockId = setInterval(() => {
    if (gameState !== STATE.PLAYING) { _mBeat++; return; }

    try {
      const ac = getAudioCtx();
      const b  = _mBeat;

      // ── Kick drum: beats 1 & 3 of each bar (every 8 sixteenth-notes)
      if (b % 8 === 0) {
        _osc(ac, masterGain, 150, 'sine', 0.30, 0.18, 32);   // sub sweep
        _noise(ac, masterGain, 0.05, 0.03, 7000);             // click transient
      }

      // ── Snare: beats 2 & 4 (offset by 4 sixteenth-notes)
      if (b % 8 === 4) {
        _noise(ac, masterGain, 0.10, 0.14, 7000, 'bandpass');
        _osc(ac, masterGain, 220, 'triangle', 0.06, 0.10, 175);
      }

      // ── Hi-hat: every 2nd sixteenth (open hat on beat 1)
      if (b % 2 === 0) {
        const hVol = b % 8 === 0 ? 0.04 : 0.018;
        _noise(ac, masterGain, hVol, 0.045, 14000);
      }

      // ── Crash/open hit: downbeat of every 4th bar (64 sixteenth-notes)
      if (b % 64 === 0 && b > 0) {
        _noise(ac, masterGain, 0.08, 0.60, 10000);
      }

      // ── Bass line: every quarter note (4 sixteenth-notes)
      if (b % 4 === 0) {
        const bFreq = _BASS_NOTES[(b / 4) % _BASS_NOTES.length];
        _osc(ac, masterGain, bFreq,     'sawtooth', 0.14, 0.36);
        _osc(ac, masterGain, bFreq * 2, 'sine',     0.04, 0.28);
      }

      // ── Melody: every 3 sixteenth-notes (creates syncopated groove)
      if (b % 3 === 0) {
        const mFreq = _MEL_NOTES[_mMelStep % _MEL_NOTES.length];
        _bell(ac, masterGain, mFreq, 0.07, 0.30);
        _mMelStep++;
      }

      // ── Chord stab: every 2 bars = 32 sixteenth-notes
      if (b % 32 === 0) {
        const chord = _CHORDS[(b / 32) % _CHORDS.length];
        chord.forEach(f => _osc(ac, masterGain, f, 'triangle', 0.05, 0.40));
      }

    } catch(e) {}

    _mBeat++;
  }, 120);
}

function stopMusic() {
  if (musicClockId) { clearInterval(musicClockId); musicClockId = null; }
}

/* ============================================================
   8. STAR FIELD
============================================================ */
let stars = [];

function initStars() {
  stars = [];
  for (let i = 0; i < CONFIG.numStars; i++) {
    const layer = Math.floor(Math.random() * 3);
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * layout.groundY * 0.85,
      size: [0.6, 1.1, 1.8][layer],
      opacity: 0.3 + Math.random() * 0.7,
      speed: [0.05, 0.15, 0.3][layer],
      twinkle: 0.01 + Math.random() * 0.03,
      twinkleOff: Math.random() * Math.PI * 2,
      layer,
    });
  }
}

function updateAndDrawStars() {
  for (const s of stars) {
    if (gameState === STATE.PLAYING) {
      s.y += s.speed * gameData.speed * 0.15;
      if (s.y > layout.groundY) { s.y = 0; s.x = Math.random() * canvas.width; }
    }
    const op = s.opacity * (0.7 + 0.3 * Math.sin(gameData.frameCount * s.twinkle + s.twinkleOff));
    ctx.save();
    ctx.globalAlpha = op;
    ctx.fillStyle   = s.layer === 2 ? '#d4bbff' : '#fff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ============================================================
   9. CITYSCAPE
============================================================ */
let cityBuildings = [];

function initCityscape() {
  cityBuildings = [];
  let x = -50;
  while (x < canvas.width + 50) {
    const w = 40 + Math.random() * 80;
    const h = 60 + Math.random() * (layout.groundY * 0.45);
    const cols = Math.floor(w / 14);
    const rows = Math.floor(h / 18);
    const windows = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => Math.random() > 0.4)
    );
    cityBuildings.push({ x, y: layout.groundY - h, w, h, rows, cols, windows });
    x += w + 2 + Math.random() * 8;
  }
}

function drawCityscape() {
  for (const b of cityBuildings) {
    ctx.fillStyle = '#0f0820';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const winW = 5, winH = 6;
    const padX = (b.w - b.cols * (winW + 4)) / 2;
    const colors = ['#f59e0b', '#22d3ee', '#e2e8f0'];
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        if (!b.windows[r][c]) continue;
        const wx = b.x + padX + c * (winW + 4);
        const wy = b.y + 8 + r * (winH + 5);
        ctx.fillStyle   = colors[(r * b.cols + c) % 3];
        ctx.globalAlpha = 0.55;
        ctx.fillRect(wx, wy, winW, winH);
      }
    }
    ctx.globalAlpha = 1;
  }
}

/* ============================================================
   10. GROUND TILES — Endless scrolling tile system (Step 9)
============================================================ */
let groundTiles = [];
const TILE_H = 24;   // height of each tile row

function initGroundTiles() {
  groundTiles = [];
  const tileCount = Math.ceil(canvas.width / layout.laneWidth) + 2;
  // One row of tiles across the ground
  for (let i = 0; i < tileCount; i++) {
    groundTiles.push({ x: i * layout.laneWidth, crack: Math.random() > 0.7 });
  }
}

function updateAndDrawGroundTiles() {
  const speed = gameData.speed * 1.2;

  // Move tiles left
  for (const t of groundTiles) { t.x -= speed; }

  // Recycle tiles that go off left edge
  const leftmost = groundTiles.reduce((a, b) => a.x < b.x ? a : b);
  const rightmost = groundTiles.reduce((a, b) => a.x > b.x ? a : b);
  if (leftmost.x < -layout.laneWidth) {
    leftmost.x    = rightmost.x + layout.laneWidth;
    leftmost.crack = Math.random() > 0.7;
  }

  // Draw tiles
  const gY = layout.groundY + 4;
  for (const t of groundTiles) {
    // Tile background
    ctx.fillStyle = 'rgba(30, 12, 60, 0.6)';
    ctx.fillRect(t.x + 1, gY, layout.laneWidth - 2, TILE_H);

    // Tile border
    ctx.strokeStyle = 'rgba(124, 58, 237, 0.15)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(t.x + 1, gY, layout.laneWidth - 2, TILE_H);

    // Optional crack detail
    if (t.crack) {
      ctx.save();
      ctx.strokeStyle = 'rgba(124, 58, 237, 0.12)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      const cx = t.x + layout.laneWidth * 0.3;
      ctx.moveTo(cx, gY + 4);
      ctx.lineTo(cx + 8, gY + 12);
      ctx.lineTo(cx + 4, gY + TILE_H - 3);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ============================================================
   11. NEON GRID
============================================================ */
function drawNeonGrid() {
  const gY = layout.groundY;
  const gH = CONFIG.groundHeight;
  const w  = canvas.width;
  const scrollOffset = (gameData.frameCount * gameData.speed * 0.8) % 40;

  ctx.save();
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.18)';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const y = gY + gH * t * t;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  const numV = 12;
  const colW = w / numV;
  for (let i = -1; i <= numV + 1; i++) {
    const x = i * colW - (scrollOffset % colW);
    ctx.beginPath(); ctx.moveTo(x, gY); ctx.lineTo(x, gY + gH); ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   12. PLAYER OBJECT
============================================================ */
let player = null;

function createPlayer() {
  const lane = 1;
  return {
    lane, targetLane: lane,
    x: layout.laneCenterX[lane], targetX: layout.laneCenterX[lane],
    y: layout.groundY - CONFIG.playerHeight,
    w: CONFIG.playerWidth, h: CONFIG.playerHeight,
    currentH: CONFIG.playerHeight,
    vy: 0, isGrounded: true, isJumping: false,
    jumpCount: 0, maxJumps: 2,   // double-jump support
    isSliding: false,            // horizontal lane sliding
    isSliding_down: false,       // ducking / slide
    slideTimer: 0,
    animFrame: 0, animTimer: 0, animSpeed: 6,
    trail: [],
    isDead: false,
    shield: false, shieldTimer: 0,
    magnet: false, magnetTimer: 0,
    x2score: false, x2Timer: 0,
    deathFlash: 0,               // frames of red flash on hit
  };
}

/* ============================================================
   13. PLAYER UPDATE
============================================================ */
function updatePlayer() {
  if (!player || player.isDead) return;

  // Power-up timers
  if (player.shield   && --player.shieldTimer  <= 0) player.shield   = false;
  if (player.magnet   && --player.magnetTimer  <= 0) player.magnet   = false;
  if (player.x2score  && --player.x2Timer      <= 0) player.x2score  = false;
  if (player.deathFlash > 0) player.deathFlash--;

  // Slide countdown
  if (player.isSliding_down) {
    player.slideTimer--;
    player.currentH += (CONFIG.slideHeight - player.currentH) * 0.25;
    if (player.slideTimer <= 0) { player.isSliding_down = false; player.slideTimer = 0; }
  } else {
    player.currentH += (CONFIG.playerHeight - player.currentH) * 0.2;
  }
  player.h = Math.round(player.currentH);

  // Vertical physics
  if (!player.isGrounded) {
    player.vy += CONFIG.gravity;
    player.y  += player.vy;
    const gY = layout.groundY - player.h;
    if (player.y >= gY) {
      player.y = gY; player.vy = 0;
      player.isGrounded = true; player.isJumping = false;
      player.jumpCount = 0;      // reset double-jump on landing
    }
  } else {
    player.y = layout.groundY - player.h;
  }

  // Lane slide (horizontal)
  player.targetX = layout.laneCenterX[player.targetLane];
  const dx = player.targetX - player.x;
  if (Math.abs(dx) < 1) {
    player.x = player.targetX; player.lane = player.targetLane; player.isSliding = false;
  } else {
    player.x += dx * 0.25; player.isSliding = true;  // snappier lane switch
  }

  // Run animation
  player.animTimer++;
  const fs = Math.max(2, player.animSpeed - Math.floor(gameData.speed / 4));
  if (player.animTimer >= fs) { player.animTimer = 0; player.animFrame = (player.animFrame + 1) % 8; }

  // Trail
  player.trail.push({ x: player.x, y: player.y + player.h / 2, alpha: 0.5 });
  if (player.trail.length > 10) player.trail.shift();
  player.trail.forEach(p => { p.alpha -= 0.04; });
}

/* ============================================================
   14. PLAYER ACTIONS
============================================================ */
function playerJump() {
  if (!player || player.isDead) return;
  // Cancel slide and jump instead
  if (player.isSliding_down) { player.isSliding_down = false; player.slideTimer = 0; }
  // Allow jump if on ground OR if a double-jump is still available
  if (player.jumpCount >= player.maxJumps) return;
  // Second jump: slightly weaker force for feel
  const force = player.jumpCount === 0 ? CONFIG.jumpForce : CONFIG.jumpForce * 0.85;
  player.vy         = force;
  player.isGrounded = false;
  player.isJumping  = true;
  player.jumpCount++;
  // Slightly higher-pitched sound on double jump
  if (player.jumpCount === 2) {
    try {
      const ac = getAudioCtx();
      _osc(ac, masterGain, 300, 'sine',     0.18, 0.18, 720);
      _osc(ac, masterGain, 520, 'triangle', 0.08, 0.14, 1000);
    } catch(e) {}
  } else {
    SFX.jump();
  }
}
function playerSlide() {
  if (!player || player.isDead || !player.isGrounded || player.isJumping || player.isSliding_down) return;
  player.isSliding_down = true; player.slideTimer = CONFIG.slideDuration;
  SFX.slide();
}
function playerMoveLeft() {
  if (!player || player.isDead || player.targetLane <= 0) return;
  player.targetLane--; player.isSliding = true;
}
function playerMoveRight() {
  if (!player || player.isDead || player.targetLane >= CONFIG.numLanes - 1) return;
  player.targetLane++; player.isSliding = true;
}

/* ============================================================
   15. KEYBOARD CONTROLS
============================================================ */
const keysHeld = {};
document.addEventListener('keydown', (e) => {
  if (keysHeld[e.code]) return;
  keysHeld[e.code] = true;
  if (e.code === 'Escape') {
    if (gameState === STATE.PLAYING) pauseGame();
    else if (gameState === STATE.PAUSED) resumeGame();
    return;
  }
  if (gameState !== STATE.PLAYING) return;
  switch (e.code) {
    case 'ArrowLeft':  case 'KeyA':               playerMoveLeft();  break;
    case 'ArrowRight': case 'KeyD':               playerMoveRight(); break;
    case 'ArrowUp':    case 'KeyW': case 'Space':  playerJump();      break;
    case 'ArrowDown':  case 'KeyS':               playerSlide();     break;
  }
});
document.addEventListener('keyup', (e) => { keysHeld[e.code] = false; });

/* ============================================================
   16. TOUCH / SWIPE CONTROLS
============================================================ */
let touchStart = { x: 0, y: 0, t: 0 };
let touchActive = false;

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  touchStart  = { x: t.clientX, y: t.clientY, t: Date.now() };
  touchActive = true;
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (!touchActive || gameState !== STATE.PLAYING) { touchActive = false; return; }
  touchActive = false;
  const t    = e.changedTouches[0];
  const dx   = t.clientX - touchStart.x;
  const dy   = t.clientY - touchStart.y;
  const dist = Math.hypot(dx, dy);
  const dt   = Date.now() - touchStart.t;
  if (dist < CONFIG.swipeThreshold && dt < 200) { playerJump(); return; }
  if (dist >= CONFIG.swipeThreshold) {
    if (Math.abs(dx) > Math.abs(dy)) {
      dx < 0 ? playerMoveLeft() : playerMoveRight();
    } else {
      dy < 0 ? playerJump() : playerSlide();
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

/* ============================================================
   17. OBSTACLES — Step 10 (Spawn, scroll, draw)
   Three obstacle types:
     'barrier'  — tall wall blocking full lane
     'box'      — squat crate (can be jumped or slid under? no — must jump)
     'low'      — low rail (must jump OR slide over)
     'high'     — high arch (must slide under)
============================================================ */
let obstacles = [];

const OBSTACLE_TYPES = ['barrier', 'box', 'low', 'high'];
const OBSTACLE_COLORS = {
  barrier: { fill: '#be123c', glow: '#f43f5e' },
  box:     { fill: '#b45309', glow: '#f59e0b' },
  low:     { fill: '#0f766e', glow: '#2dd4bf' },
  high:    { fill: '#4f46e5', glow: '#818cf8' },
};

function obstacleSpawnFreq() {
  return Math.max(
    CONFIG.obstacleMinFreq,
    CONFIG.obstacleBaseFreq - Math.floor(gameData.speed * 4)
  );
}

function spawnObstacle() {
  const type = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
  // Pick 1 or 2 lanes to block (never all 3)
  const blockedLanes = shuffleArray([0, 1, 2]).slice(0, Math.random() < 0.35 ? 2 : 1);

  const pw = CONFIG.playerWidth;
  const ph = CONFIG.playerHeight;

  let obsH, obsY;
  switch (type) {
    case 'barrier': obsH = ph * 1.2;    obsY = layout.groundY - obsH; break;
    case 'box':     obsH = ph * 0.55;   obsY = layout.groundY - obsH; break;
    case 'low':     obsH = ph * 0.28;   obsY = layout.groundY - obsH; break;
    case 'high':    obsH = ph * 0.55;   obsY = layout.groundY - ph;   break; // gap below
  }

  for (const lane of blockedLanes) {
    obstacles.push({
      type,
      lane,
      x: canvas.width + 20,
      y: obsY,
      w: pw * 1.1,
      h: obsH,
      cx: canvas.width + 20 + pw * 0.55,
    });
  }
}

function updateObstacles() {
  // Spawn
  if (gameData.frameCount - gameData.lastObstFrame > obstacleSpawnFreq()) {
    spawnObstacle();
    gameData.lastObstFrame = gameData.frameCount;
  }

  // Move & remove off-screen
  for (let i = obstacles.length - 1; i >= 0; i--) {
    obstacles[i].x  -= gameData.speed;
    obstacles[i].cx -= gameData.speed;
    if (obstacles[i].x + obstacles[i].w < 0) obstacles.splice(i, 1);
  }
}

function drawObstacles() {
  for (const o of obstacles) {
    const col = OBSTACLE_COLORS[o.type];
    ctx.save();
    ctx.shadowColor = col.glow;
    ctx.shadowBlur  = 16;
    ctx.fillStyle   = col.fill;

    if (o.type === 'high') {
      // Arch: two pillars with gap underneath
      const pillarW = o.w * 0.3;
      ctx.fillRect(o.x,           o.y, pillarW,    o.h);       // left pillar
      ctx.fillRect(o.x + o.w - pillarW, o.y, pillarW, o.h);   // right pillar
      ctx.fillRect(o.x, o.y, o.w, pillarW);                    // top bar
    } else if (o.type === 'barrier') {
      // Chevron-striped barrier
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle   = 'rgba(255,255,255,0.12)';
      ctx.shadowBlur  = 0;
      for (let s = 0; s < 4; s++) {
        const sy = o.y + (o.h / 4) * s;
        ctx.fillRect(o.x, sy, o.w, o.h / 8);
      }
    } else if (o.type === 'low') {
      // Low flat rail with end caps
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle  = col.glow;
      ctx.fillRect(o.x, o.y, 6, o.h);
      ctx.fillRect(o.x + o.w - 6, o.y, 6, o.h);
    } else {
      // Box / crate
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.strokeStyle = col.glow;
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 6;
      ctx.strokeRect(o.x + 3, o.y + 3, o.w - 6, o.h - 6);
      // X mark
      ctx.beginPath();
      ctx.moveTo(o.x + 6, o.y + 6); ctx.lineTo(o.x + o.w - 6, o.y + o.h - 6);
      ctx.moveTo(o.x + o.w - 6, o.y + 6); ctx.lineTo(o.x + 6, o.y + o.h - 6);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ============================================================
   18. COINS — Step 12
   Coins appear in patterns: line, arc, or scattered.
============================================================ */
let coins = [];

const COIN_PATTERNS = ['line', 'arc', 'scatter'];

function coinSpawnFreq() {
  return Math.max(CONFIG.coinMinFreq, CONFIG.coinBaseFreq - Math.floor(gameData.speed * 2));
}

function spawnCoins() {
  const pattern = COIN_PATTERNS[Math.floor(Math.random() * COIN_PATTERNS.length)];
  const lane    = Math.floor(Math.random() * CONFIG.numLanes);
  const cx      = layout.laneCenterX[lane];
  const r       = CONFIG.coinSize / 2;
  const gY      = layout.groundY;

  if (pattern === 'line') {
    for (let i = 0; i < 6; i++) {
      coins.push({ x: canvas.width + 20 + i * 55, y: gY - CONFIG.playerHeight * 0.6, r, lane, rot: 0 });
    }
  } else if (pattern === 'arc') {
    for (let i = 0; i < 7; i++) {
      const t  = (i / 6) * Math.PI;
      const ax = canvas.width + 20 + i * 45;
      const ay = gY - CONFIG.playerHeight * 0.5 - Math.sin(t) * 60;
      coins.push({ x: ax, y: ay, r, lane, rot: 0 });
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const randLane = Math.floor(Math.random() * CONFIG.numLanes);
      const randX = canvas.width + 30 + Math.random() * 180;
      const randY = gY - CONFIG.playerHeight * (0.3 + Math.random() * 0.6);
      coins.push({ x: randX, y: randY, r, lane: randLane, rot: 0 });
    }
  }
}

function updateCoins() {
  if (gameData.frameCount - gameData.lastCoinFrame > coinSpawnFreq()) {
    spawnCoins();
    gameData.lastCoinFrame = gameData.frameCount;
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.x   -= gameData.speed;
    c.rot  += 0.08;

    // Magnet attraction
    if (player && player.magnet && !player.isDead) {
      const dx = player.x - c.x;
      const dy = (player.y + player.h / 2) - c.y;
      const d  = Math.hypot(dx, dy);
      if (d < 200) {
        c.x += (dx / d) * 6;
        c.y += (dy / d) * 6;
      }
    }

    if (c.x + c.r < 0) coins.splice(i, 1);
  }
}

function drawCoins() {
  for (const c of coins) {
    ctx.save();
    ctx.translate(c.x, c.y);

    // Outer glow ring
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur  = 12;

    // Coin body (ellipse = 3D rotation feel)
    const scaleX = Math.abs(Math.cos(c.rot));
    ctx.scale(scaleX < 0.15 ? 0.15 : scaleX, 1);

    const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, c.r);
    grad.addColorStop(0,   '#fde68a');
    grad.addColorStop(0.6, '#f59e0b');
    grad.addColorStop(1,   '#b45309');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.arc(0, 0, c.r, 0, Math.PI * 2);
    ctx.fill();

    // $ sign
    ctx.fillStyle   = 'rgba(255,255,255,0.5)';
    ctx.font        = `bold ${c.r}px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur  = 0;
    if (scaleX > 0.5) ctx.fillText('$', 0, 0);

    ctx.restore();
  }
}

/* ============================================================
   19. POWER-UPS — Step 15
   Types: 'shield', 'magnet', 'x2score'
============================================================ */
let powerups = [];

const POWERUP_DEFS = {
  shield:  { color: '#06b6d4', glow: '#22d3ee', label: '🛡', duration: 300 },
  magnet:  { color: '#ec4899', glow: '#f9a8d4', label: '🧲', duration: 250 },
  x2score: { color: '#10b981', glow: '#6ee7b7', label: '×2', duration: 400 },
};

function spawnPowerup() {
  const types = Object.keys(POWERUP_DEFS);
  const type  = types[Math.floor(Math.random() * types.length)];
  const lane  = Math.floor(Math.random() * CONFIG.numLanes);
  powerups.push({
    type,
    x: canvas.width + 40,
    y: layout.groundY - CONFIG.playerHeight * 0.7,
    size: 22,
    lane,
    spin: 0,
  });
}

function updatePowerups() {
  if (gameData.frameCount - gameData.lastPowerFrame > CONFIG.powerupFreq) {
    spawnPowerup();
    gameData.lastPowerFrame = gameData.frameCount;
  }
  for (let i = powerups.length - 1; i >= 0; i--) {
    powerups[i].x    -= gameData.speed;
    powerups[i].spin += 0.04;
    if (powerups[i].x < -60) powerups.splice(i, 1);
  }
}

function drawPowerups() {
  for (const p of powerups) {
    const def = POWERUP_DEFS[p.type];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);

    ctx.shadowColor = def.glow;
    ctx.shadowBlur  = 20;
    ctx.fillStyle   = def.color;

    // Hexagon shape
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const fn = i === 0 ? 'moveTo' : 'lineTo';
      ctx[fn](Math.cos(angle) * p.size, Math.sin(angle) * p.size);
    }
    ctx.closePath();
    ctx.fill();

    ctx.rotate(-p.spin);
    ctx.fillStyle    = '#fff';
    ctx.font         = `bold ${p.size * 0.85}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur   = 0;
    ctx.fillText(def.label, 0, 1);
    ctx.restore();
  }
}

/* ============================================================
   20. COLLISION DETECTION — Step 11
   AABB (Axis-Aligned Bounding Box) with margin forgiveness.
============================================================ */
const CM = CONFIG.collisionMargin; // forgiveness margin

function getPlayerRect() {
  return {
    left:   player.x - player.w / 2 + CM,
    right:  player.x + player.w / 2 - CM,
    top:    player.y + CM,
    bottom: player.y + player.h - CM,
  };
}

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left &&
         a.top  < b.bottom && a.bottom > b.top;
}

function checkCollisions() {
  if (!player || player.isDead) return;

  const pr = getPlayerRect();

  // --- Obstacle collisions ---
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o  = obstacles[i];
    let or_;

    if (o.type === 'high') {
      // High arch: collision only with the pillars & top bar, not the gap
      const pillarW = o.w * 0.3;
      const leftPillar  = { left: o.x, right: o.x + pillarW, top: o.y, bottom: o.y + o.h };
      const rightPillar = { left: o.x + o.w - pillarW, right: o.x + o.w, top: o.y, bottom: o.y + o.h };
      const topBar      = { left: o.x, right: o.x + o.w, top: o.y, bottom: o.y + pillarW };
      if (!rectsOverlap(pr, leftPillar) && !rectsOverlap(pr, rightPillar) && !rectsOverlap(pr, topBar)) continue;
    } else {
      or_ = { left: o.x + CM, right: o.x + o.w - CM, top: o.y + CM, bottom: o.y + o.h - CM };
      if (!rectsOverlap(pr, or_)) continue;
    }

    // Hit!
    if (player.shield) {
      // Shield absorbs hit
      player.shield      = false;
      player.shieldTimer = 0;
      player.deathFlash  = 20;
      obstacles.splice(i, 1);
      SFX.shield();
    } else {
      hitPlayer();
      return;
    }
  }

  // --- Coin collisions ---
  for (let i = coins.length - 1; i >= 0; i--) {
    const c  = coins[i];
    const cr = { left: c.x - c.r, right: c.x + c.r, top: c.y - c.r, bottom: c.y + c.r };
    if (!rectsOverlap(pr, cr)) continue;
    coins.splice(i, 1);
    gameData.coins++;
    const pts = CONFIG.coinPoints * (player.x2score ? 2 : 1);
    gameData.score += pts;
    SFX.coin();
    showFloatingText(`+${pts}`, player.x, player.y - 20, '#f59e0b');
  }

  // --- Power-up collisions ---
  for (let i = powerups.length - 1; i >= 0; i--) {
    const p  = powerups[i];
    const pr2 = { left: p.x - p.size, right: p.x + p.size, top: p.y - p.size, bottom: p.y + p.size };
    if (!rectsOverlap(pr, pr2)) continue;
    powerups.splice(i, 1);
    const def = POWERUP_DEFS[p.type];
    player[p.type]       = true;
    player[`${p.type === 'x2score' ? 'x2' : p.type}Timer`] = def.duration;
    SFX.powerup();
    showFloatingText(def.label + ' ACTIVATED!', player.x, player.y - 30, def.glow);
  }
}

function hitPlayer() {
  player.isDead    = true;
  player.deathFlash = 40;
  SFX.hit();
  stopMusic();
  setTimeout(triggerGameOver, 800);
}

/* ============================================================
   21. FLOATING TEXT — score popups and notifications
============================================================ */
let floatingTexts = [];

function showFloatingText(text, x, y, color) {
  floatingTexts.push({ text, x, y, color, alpha: 1, vy: -1.5, life: 60 });
}

function updateAndDrawFloatingTexts() {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y     += ft.vy;
    ft.alpha -= 1 / ft.life;
    ft.life--;
    if (ft.life <= 0) { floatingTexts.splice(i, 1); continue; }

    ctx.save();
    ctx.globalAlpha  = ft.alpha;
    ctx.fillStyle    = ft.color;
    ctx.font         = `bold 16px 'Orbitron', monospace`;
    ctx.textAlign    = 'center';
    ctx.shadowColor  = ft.color;
    ctx.shadowBlur   = 10;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

/* ============================================================
   22. POWER-UP STATUS BAR — shows active power-ups in HUD area
============================================================ */
function drawPowerupStatus() {
  if (!player) return;
  const indicators = [];
  if (player.shield)  indicators.push({ label: '🛡 SHIELD',   color: '#22d3ee', timer: player.shieldTimer,  max: POWERUP_DEFS.shield.duration  });
  if (player.magnet)  indicators.push({ label: '🧲 MAGNET',   color: '#f9a8d4', timer: player.magnetTimer,  max: POWERUP_DEFS.magnet.duration  });
  if (player.x2score) indicators.push({ label: '×2 SCORE',    color: '#6ee7b7', timer: player.x2Timer,      max: POWERUP_DEFS.x2score.duration });

  indicators.forEach((ind, i) => {
    const bx = 12 + i * 130;
    const by = 64;
    const bw = 118;
    const bh = 22;

    ctx.save();
    ctx.fillStyle    = 'rgba(0,0,0,0.4)';
    ctx.strokeStyle  = ind.color;
    ctx.lineWidth    = 1;
    roundedRect(ctx, bx, by, bw, bh, 6); ctx.fill(); ctx.stroke();

    // Progress bar
    const prog = ind.timer / ind.max;
    ctx.fillStyle = ind.color + '55';
    roundedRect(ctx, bx + 1, by + 1, (bw - 2) * prog, bh - 2, 5); ctx.fill();

    ctx.fillStyle    = '#fff';
    ctx.font         = `700 9px 'Orbitron', monospace`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = ind.color;
    ctx.shadowBlur   = 6;
    ctx.fillText(ind.label, bx + 8, by + bh / 2);
    ctx.restore();
  });
}

/* ============================================================
   23. PLAYER DRAW
============================================================ */
function drawPlayer() {
  if (!player) return;
  drawPlayerTrail();

  // Death flash: red tint overlay
  if (player.deathFlash > 0 && player.isDead) {
    ctx.save();
    ctx.globalAlpha = player.deathFlash / 40 * 0.5;
    ctx.fillStyle   = '#ef4444';
    ctx.fillRect(player.x - player.w, player.y - 10, player.w * 2, player.h + 20);
    ctx.restore();
  }

  // Shield glow ring
  if (player.shield) {
    ctx.save();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth   = 3;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 24;
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(gameData.frameCount * 0.15);
    ctx.beginPath();
    ctx.ellipse(player.x, player.y + player.h / 2, player.w * 0.85, player.h * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawCharacter(
    player.x, player.y,
    player.animFrame, player.isJumping,
    player.isGrounded, player.isSliding_down, player.currentH
  );
}

function drawPlayerTrail() {
  for (const t of player.trail) {
    if (t.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, t.alpha) * 0.55;
    ctx.fillStyle   = player.x2score ? '#10b981' : '#7c3aed';
    ctx.shadowColor = player.x2score ? '#10b981' : '#7c3aed';
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.ellipse(t.x, t.y, 8, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCharacter(cx, y, frame, isJumping, isGrounded, isSliding_down, currentH) {
  const h = currentH;
  const w = CONFIG.playerWidth;
  const runAngle = Math.sin((frame / 8) * Math.PI * 2);

  const scaleY = isSliding_down ? 0.5 : isJumping ? 1.15 :
                 (!isGrounded && player.vy > 5) ? 0.88 : 1.0;
  const scaleX = isSliding_down ? 1.4 : isJumping ? 0.88 : 1.0;

  ctx.save();
  ctx.translate(cx, y + h / 2);
  ctx.scale(scaleX, scaleY);

  const halfH = h / 2;
  const scarfOffset = runAngle * 6;

  // Scarf
  ctx.save();
  ctx.globalAlpha = 0.75; ctx.strokeStyle = '#f43f5e';
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -halfH + 6);
  ctx.bezierCurveTo(-12 + scarfOffset, -halfH - 4, -20 + scarfOffset * 2, -halfH + 10, -18 + scarfOffset * 1.5, -halfH + 22);
  ctx.stroke(); ctx.restore();

  // Body
  ctx.save();
  ctx.fillStyle = '#1e1b4b'; ctx.shadowColor = '#7c3aed'; ctx.shadowBlur = 10;
  roundedRect(ctx, -w * 0.38, -halfH * 0.25, w * 0.76, halfH * 0.65, 6); ctx.fill(); ctx.restore();

  // Chest stripe
  ctx.save();
  ctx.fillStyle = player && player.x2score ? '#10b981' : '#7c3aed';
  ctx.shadowColor = player && player.x2score ? '#6ee7b7' : '#a855f7'; ctx.shadowBlur = 12;
  roundedRect(ctx, -5, -halfH * 0.2, 10, halfH * 0.55, 3); ctx.fill(); ctx.restore();

  // Head
  const headR = w * 0.32;
  const headY = -halfH + headR;
  ctx.save();
  ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2;
  ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.arc(0, headY, headR + 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();

  ctx.save();
  ctx.fillStyle = '#312e81';
  ctx.beginPath(); ctx.arc(0, headY, headR, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  // Visor
  ctx.save();
  ctx.fillStyle = player && player.shield ? '#22d3ee' : '#22d3ee';
  ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 14;
  roundedRect(ctx, -headR * 0.7, headY - 3, headR * 1.4, 6, 3); ctx.fill(); ctx.restore();

  // Arms
  drawLimb(ctx, 0, -halfH * 0.1, w * 0.52, runAngle * 0.7,  -1, '#4338ca', '#818cf8', 5, 5, false);
  drawLimb(ctx, 0, -halfH * 0.1, w * 0.52, -runAngle * 0.7, 1,  '#4338ca', '#818cf8', 5, 5, false);

  // Legs
  drawLimb(ctx, 0, halfH * 0.38, halfH * 0.65, -runAngle * 0.85, -1, '#1e1b4b', '#4338ca', 7, 6, true);
  drawLimb(ctx, 0, halfH * 0.38, halfH * 0.65,  runAngle * 0.85,  1, '#1e1b4b', '#4338ca', 7, 6, true);

  ctx.restore();
}

function drawLimb(ctx, ox, oy, len, angle, side, color, tipColor, lineW, tipR, isLeg) {
  const endX = ox + side * Math.sin(angle) * len;
  const endY = oy + Math.cos(angle) * len;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lineW; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(endX, endY); ctx.stroke(); ctx.restore();
  ctx.save();
  ctx.fillStyle = tipColor; ctx.shadowColor = tipColor; ctx.shadowBlur = isLeg ? 8 : 6;
  ctx.beginPath();
  if (isLeg) ctx.ellipse(endX, endY, tipR, tipR * 0.55, angle * side, 0, Math.PI * 2);
  else ctx.arc(endX, endY, tipR, 0, Math.PI * 2);
  ctx.fill(); ctx.restore();
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ============================================================
   24. LANE SYSTEM — Step 8
============================================================ */
function drawLanes() {
  drawLaneFloors();
  drawActiveLaneHighlight();
  drawLaneEdgeWalls();
  drawLaneDividers();
}

function drawLaneFloors() {
  for (let i = 0; i < CONFIG.numLanes; i++) {
    const x = i * layout.laneWidth;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(20, 8, 50, 0.5)' : 'rgba(14, 5, 36, 0.5)';
    ctx.fillRect(x, layout.groundY, layout.laneWidth, CONFIG.groundHeight);
  }
}

function drawActiveLaneHighlight() {
  if (!player) return;
  const ax = player.x - layout.laneWidth / 2;
  ctx.save();
  const grad = ctx.createLinearGradient(ax, layout.groundY, ax + layout.laneWidth, layout.groundY);
  grad.addColorStop(0,   'rgba(124,58,237,0)');
  grad.addColorStop(0.5, 'rgba(124,58,237,0.18)');
  grad.addColorStop(1,   'rgba(124,58,237,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(ax, layout.groundY, layout.laneWidth, CONFIG.groundHeight);
  ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 14;
  ctx.fillStyle   = 'rgba(168,85,247,0.35)';
  ctx.fillRect(ax, layout.groundY, layout.laneWidth, 2);
  ctx.restore();
}

function drawLaneEdgeWalls() {
  const wallW = 3;
  ['left', 'right'].forEach(side => {
    ctx.save();
    ctx.shadowColor = '#7c3aed'; ctx.shadowBlur = 20; ctx.fillStyle = '#7c3aed';
    ctx.fillRect(side === 'left' ? 0 : canvas.width - wallW, 0, wallW, canvas.height);
    ctx.restore();
  });
}

function drawLaneDividers() {
  const scrollOff = -(gameData.frameCount * gameData.speed * 0.5);
  ctx.save();
  ctx.strokeStyle = 'rgba(124,58,237,0.18)'; ctx.lineWidth = 1;
  ctx.setLineDash([20, 30]); ctx.lineDashOffset = scrollOff;
  for (let i = 1; i < CONFIG.numLanes; i++) {
    const x = layout.laneWidth * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, layout.groundY); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(124,58,237,0.35)'; ctx.lineWidth = 2;
  ctx.setLineDash([16, 20]); ctx.lineDashOffset = scrollOff;
  for (let i = 1; i < CONFIG.numLanes; i++) {
    const x = layout.laneWidth * i;
    ctx.save(); ctx.shadowColor = '#7c3aed'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(x, layout.groundY); ctx.lineTo(x, canvas.height); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawLaneArrows() {
  const arrowY   = layout.groundY + CONFIG.groundHeight * 0.55;
  const bounce   = Math.sin(gameData.frameCount * 0.08) * 4;
  const arrowSize = Math.min(layout.laneWidth * 0.14, 20);

  for (let i = 0; i < CONFIG.numLanes; i++) {
    const cx = layout.laneCenterX[i];
    const isActive = player && player.targetLane === i;
    ctx.save();
    ctx.globalAlpha = isActive ? 0.95 : 0.25;
    ctx.fillStyle   = isActive ? '#a855f7' : '#7c3aed';
    if (isActive) { ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 18; }
    const ay = arrowY + (isActive ? bounce : 0);
    ctx.beginPath();
    ctx.moveTo(cx - arrowSize, ay - arrowSize * 0.6);
    ctx.lineTo(cx,             ay + arrowSize * 0.6);
    ctx.lineTo(cx + arrowSize, ay - arrowSize * 0.6);
    ctx.lineTo(cx,             ay + arrowSize * 1.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/* ============================================================
   25. HIGH SCORE — Step 20 (LocalStorage)
============================================================ */
function loadHighScore() {
  const saved = localStorage.getItem('shadowsprint_highscore');
  gameData.highScore = saved ? parseInt(saved, 10) : 0;
  updateHUD();
}
function saveHighScore() {
  if (gameData.score > gameData.highScore) {
    gameData.highScore = Math.floor(gameData.score);
    localStorage.setItem('shadowsprint_highscore', gameData.highScore);
  }
}

/* ============================================================
   26. HUD
============================================================ */
const scoreDisplay     = document.getElementById('score-display');
const highscoreDisplay = document.getElementById('highscore-display');
const finalScoreEl     = document.getElementById('final-score');
const finalCoinsEl     = document.getElementById('final-coins');
const finalHighscoreEl = document.getElementById('final-highscore');

function updateHUD() {
  scoreDisplay.textContent     = Math.floor(gameData.score);
  highscoreDisplay.textContent = Math.floor(gameData.highScore);
}

/* ============================================================
   27. SCREEN MANAGEMENT
============================================================ */
const startScreen    = document.getElementById('start-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const pauseScreen    = document.getElementById('pause-screen');
const pauseBtn       = document.getElementById('pause-btn');

function showScreen(state) {
  [startScreen, gameoverScreen, pauseScreen].forEach(s => s.classList.add('hidden'));
  pauseBtn.classList.add('hidden');

  if (state === STATE.START)    startScreen.classList.remove('hidden');
  else if (state === STATE.GAMEOVER) {
    finalScoreEl.textContent     = Math.floor(gameData.score);
    finalCoinsEl.textContent     = gameData.coins;
    finalHighscoreEl.textContent = Math.floor(gameData.highScore);
    gameoverScreen.classList.remove('hidden');
  }
  else if (state === STATE.PAUSED)  { pauseScreen.classList.remove('hidden'); pauseBtn.classList.remove('hidden'); }
  else if (state === STATE.PLAYING) pauseBtn.classList.remove('hidden');
}

/* ============================================================
   28. GAME LIFECYCLE
============================================================ */
function startGame() {
  gameData.score          = 0;
  gameData.speed          = CONFIG.initialSpeed;
  gameData.frameCount     = 0;
  gameData.coins          = 0;
  gameData.lastObstFrame  = 0;
  gameData.lastCoinFrame  = 0;
  gameData.lastPowerFrame = 0;

  if (gameData.animFrameId) cancelAnimationFrame(gameData.animFrameId);
  stopIdleLoop();

  player    = createPlayer();
  obstacles = [];
  coins     = [];
  powerups  = [];
  floatingTexts = [];

  initGroundTiles();

  gameState = STATE.PLAYING;
  showScreen(STATE.PLAYING);
  updateHUD();
  startMusic();
  gameLoop();
}

function triggerGameOver() {
  gameState = STATE.GAMEOVER;
  saveHighScore();
  showScreen(STATE.GAMEOVER);
  updateHUD();
  cancelAnimationFrame(gameData.animFrameId);
  stopMusic();
}

function pauseGame() {
  if (gameState !== STATE.PLAYING) return;
  gameState = STATE.PAUSED;
  showScreen(STATE.PAUSED);
  cancelAnimationFrame(gameData.animFrameId);
  stopMusic();
}

function resumeGame() {
  if (gameState !== STATE.PAUSED) return;
  gameState = STATE.PLAYING;
  showScreen(STATE.PLAYING);
  startMusic();
  gameLoop();
}

/* ============================================================
   29. MAIN GAME LOOP
============================================================ */
function gameLoop() {
  if (gameState !== STATE.PLAYING) return;
  gameData.animFrameId = requestAnimationFrame(gameLoop);
  update();
  draw();
}

/* ============================================================
   30. UPDATE — All game logic per frame
============================================================ */
function update() {
  gameData.frameCount++;

  // Speed ramp — Step 14
  gameData.speed = Math.min(
    CONFIG.initialSpeed + gameData.frameCount * CONFIG.speedIncrement,
    CONFIG.maxSpeed
  );

  // Score — Step 13 (distance-based, doubled if x2 active)
  const multiplier = (player && player.x2score) ? 2 : 1;
  gameData.score  += gameData.speed * 0.05 * multiplier;

  if (gameData.frameCount % 3 === 0) updateHUD();

  updatePlayer();
  updateObstacles();  // Step 10
  updateCoins();      // Step 12
  updatePowerups();   // Step 15
  checkCollisions();  // Step 11
}

/* ============================================================
   31. DRAW — Full render pipeline
============================================================ */
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBackground();
  updateAndDrawStars();
  drawCityscape();
  drawGround();
  drawNeonGrid();
  updateAndDrawGroundTiles();  // Step 9
  drawLanes();
  drawLaneArrows();
  drawObstacles();             // Step 10
  drawCoins();                 // Step 12
  drawPowerups();              // Step 15
  drawPlayer();
  drawPowerupStatus();
  updateAndDrawFloatingTexts();

  // Speed indicator (subtle bottom-right)
  ctx.save();
  ctx.fillStyle   = 'rgba(124,58,237,0.5)';
  ctx.font        = '700 9px Orbitron, monospace';
  ctx.textAlign   = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`SPD ${gameData.speed.toFixed(1)}`, canvas.width - 10, canvas.height - 8);
  ctx.restore();
}

/* ============================================================
   32. DRAW HELPERS
============================================================ */
function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, layout.groundY);
  gradient.addColorStop(0,    '#060618');
  gradient.addColorStop(0.55, '#100830');
  gradient.addColorStop(1,    '#1e0a50');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, layout.groundY);
}

function drawGround() {
  const grad = ctx.createLinearGradient(0, layout.groundY, 0, canvas.height);
  grad.addColorStop(0, '#160a38');
  grad.addColorStop(1, '#08051a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, layout.groundY, canvas.width, CONFIG.groundHeight);
  ctx.save();
  ctx.shadowColor = '#7c3aed'; ctx.shadowBlur = 22;
  ctx.fillStyle   = '#9333ea';
  ctx.fillRect(0, layout.groundY, canvas.width, 2);
  ctx.restore();
}

/* ============================================================
   33. IDLE ANIMATION LOOP (start / gameover screens)
============================================================ */
let idleAnimId = null;

function idleLoop() {
  stopIdleLoop();
  function loop() {
    if (gameState === STATE.PLAYING) return;
    gameData.frameCount++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    updateAndDrawStars();
    drawCityscape();
    drawGround();
    drawNeonGrid();
    drawLanes();
    idleAnimId = requestAnimationFrame(loop);
  }
  loop();
}

function stopIdleLoop() {
  if (idleAnimId) { cancelAnimationFrame(idleAnimId); idleAnimId = null; }
}

/* ============================================================
   34. BUTTONS
============================================================ */
function addRipple(btn) {
  btn.classList.add('ripple');
  setTimeout(() => btn.classList.remove('ripple'), 600);
}

document.getElementById('start-btn').addEventListener('click', () => {
  addRipple(document.getElementById('start-btn'));
  startGame();
});
document.getElementById('restart-btn').addEventListener('click', () => {
  addRipple(document.getElementById('restart-btn'));
  startGame();
});
document.getElementById('pause-btn').addEventListener('click', pauseGame);
document.getElementById('resume-btn').addEventListener('click', () => {
  addRipple(document.getElementById('resume-btn'));
  resumeGame();
});

/* ============================================================
   35. UTILITY
============================================================ */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   36. INIT — Entry point
============================================================ */
function init() {
  loadHighScore();
  calculateLayout();
  initStars();
  initCityscape();
  idleLoop();
  showScreen(STATE.START);
}

init();
