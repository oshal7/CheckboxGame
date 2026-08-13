import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, Pause } from 'lucide-react';
import {
  getCursorTargetPosition,
  getRandomInt,
  TARGET_SIZE,
  TARGET_BORDER_RADIUS,
  CURSOR_SIZE,
  GameCursor,
  GameTarget,
} from '../utils/gameMath';
import {
  CURSOR_FILL_PATH,
  CURSOR_STROKE_PATH,
  SVG_VIEWBOX_SIZE,
  CURSOR_HOTSPOT_X,
  CURSOR_HOTSPOT_Y,
} from '../utils/cursorIcons';

// Game constants
const TARGET_INITIAL_SPEED    = 1.5;
const TARGET_SPEED_BOUNCE_MULTIPLIER = 1.1;
const TARGET_MAX_SPEED        = 6;
const INITIAL_TARGET_COUNT    = 5;
const CANVAS_MAX_WIDTH        = 700; // wider canvas

// ─── Light-mode palette ────────────────────────────────────────────────────
// One color per cursor index — visible on a white canvas
const CURSOR_COLORS = ['#2563eb', '#7c3aed', '#ea580c', '#dc2626', '#16a34a', '#0891b2'];

// Every checkbox (hit or not) uses these — consistent across all levels
const TARGET_BORDER   = '#3b82f6';        // blue-500
const TARGET_FILL     = 'rgba(59,130,246,0.10)';
const HIT_BORDER      = '#16a34a';        // green-600
const HIT_FILL        = 'rgba(22,163,74,0.12)';

type GameState = 'start' | 'playing' | 'paused' | 'gameover';

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  color: string;
  size: number;
}

interface ScorePopup {
  id: string;
  x: number; y: number;
  life: number;
}

export function TaskMasterGame() {
  // ─── Engine refs ────────────────────────────────────────────────────────
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const requestRef     = useRef<number>(0);
  const cursorsRef     = useRef<GameCursor[]>([]);
  const targetsRef     = useRef<GameTarget[]>([]);
  const particlesRef   = useRef<Particle[]>([]);
  const popupsRef      = useRef<ScorePopup[]>([]);
  const mouseRef       = useRef({ x: 0, y: 0 });
  const timeRef        = useRef<number>(60);
  const lastTimeRef    = useRef<number>(0);
  const scoreRef       = useRef<number>(0);
  const levelRef       = useRef<number>(1);
  const gameStateRef   = useRef<GameState>('start');
  const cursorCountRef = useRef<number>(1);
  const prevBestRef    = useRef<number>(0);
  const audioCtxRef    = useRef<AudioContext | null>(null);

  // ─── React state (drives the UI) ────────────────────────────────────────
  const [gameState,     setGameState]     = useState<GameState>('start');
  const [score,         setScore]         = useState(0);
  const [level,         setLevel]         = useState(1);
  const [displayTime,   setDisplayTime]   = useState(60);
  const [cursorCount,   setCursorCount]   = useState(1);
  const [selectedTime,  setSelectedTime]  = useState<30 | 60>(60);
  const [showLevelBanner, setShowLevelBanner] = useState(false);
  const [bannerLevel,   setBannerLevel]   = useState(2);
  const [isNewBest,     setIsNewBest]     = useState(false);
  const [bestScore,     setBestScore]     = useState(() => {
    try { return parseInt(localStorage.getItem('tm_best') || '0'); } catch { return 0; }
  });

  // Sync refs → state
  useEffect(() => { gameStateRef.current   = gameState;   }, [gameState]);
  useEffect(() => { cursorCountRef.current = cursorCount; }, [cursorCount]);
  useEffect(() => { levelRef.current       = level;       }, [level]);

  // ─── Audio ──────────────────────────────────────────────────────────────
  const playSound = useCallback((type: 'hit' | 'levelup' | 'gameover') => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;

      if (type === 'hit') {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(660, now);
        o.frequency.exponentialRampToValueAtTime(990, now + 0.05);
        g.gain.setValueAtTime(0.08, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        o.start(now); o.stop(now + 0.12);
      } else if (type === 'levelup') {
        [523, 659, 784, 1047].forEach((freq, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = 'sine'; o.frequency.value = freq;
          const t = now + i * 0.1;
          g.gain.setValueAtTime(0.1, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
          o.start(t); o.stop(t + 0.15);
        });
      } else {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(440, now);
        o.frequency.exponentialRampToValueAtTime(110, now + 0.5);
        g.gain.setValueAtTime(0.12, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        o.start(now); o.stop(now + 0.6);
      }
    } catch { /* audio blocked */ }
  }, []);

  // ─── Particles ──────────────────────────────────────────────────────────
  const spawnParticles = useCallback((x: number, y: number, color: string) => {
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.5 + Math.random() * 2.5;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 1,
        color,
        size: 2.5 + Math.random() * 2.5,
      });
    }
  }, []);

  // ─── Level init ─────────────────────────────────────────────────────────
  const initLevel = useCallback((lvl: number) => {
    const count = INITIAL_TARGET_COUNT + (lvl - 1) * 2;
    const canvas = canvasRef.current;
    if (!canvas) return;
    targetsRef.current = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      return {
        id:  Math.random().toString(36).substr(2, 9),
        x:   getRandomInt(TARGET_SIZE * 2, canvas.width  - TARGET_SIZE * 2),
        y:   getRandomInt(TARGET_SIZE * 2, canvas.height - TARGET_SIZE * 2),
        vx:  TARGET_INITIAL_SPEED * Math.cos(angle),
        vy:  TARGET_INITIAL_SPEED * Math.sin(angle),
        hit: false,
      };
    });
  }, []);

  // ─── Game-loop: update ──────────────────────────────────────────────────
  const update = useCallback((deltaTime: number) => {
    if (gameStateRef.current !== 'playing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cc = cursorCountRef.current;
    while (cursorsRef.current.length < cc) {
      cursorsRef.current.push({ x: canvas.width / 2, y: canvas.height / 2 });
    }
    for (let i = 0; i < cc; i++) {
      cursorsRef.current[i] = getCursorTargetPosition(
        i, mouseRef.current.x, mouseRef.current.y, canvas.width, canvas.height, cc
      );
    }

    targetsRef.current.forEach(t => {
      if (t.hit) return;
      t.x += t.vx; t.y += t.vy;
      const r = TARGET_SIZE / 2;
      let bounced = false;
      if      (t.x - r < 0)            { t.x = r;               t.vx =  Math.abs(t.vx) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      else if (t.x + r > canvas.width)  { t.x = canvas.width - r; t.vx = -Math.abs(t.vx) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      if      (t.y - r < 0)            { t.y = r;                t.vy =  Math.abs(t.vy) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      else if (t.y + r > canvas.height) { t.y = canvas.height - r; t.vy = -Math.abs(t.vy) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      if (bounced) {
        const sp = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
        if (sp > TARGET_MAX_SPEED) { const ratio = TARGET_INITIAL_SPEED / sp; t.vx *= ratio; t.vy *= ratio; }
      }
    });

    const dt = Math.min(deltaTime, 50) / 16;
    particlesRef.current = particlesRef.current.filter(p => {
      p.life -= 0.03 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.06 * dt;
      return p.life > 0;
    });
    popupsRef.current = popupsRef.current.filter(p => {
      p.life -= 0.024 * dt; p.y -= 0.5 * dt;
      return p.life > 0;
    });
  }, []);

  // ─── Game-loop: draw ────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    // 1. White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // 2. Subtle grid
    ctx.strokeStyle = 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 0.5;
    const gs = 32;
    for (let x = 0; x <= W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // 3. Particles
    particlesRef.current.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0, p.size * p.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 4. Targets — all identical in appearance, every level
    targetsRef.current.forEach(target => {
      const hs = TARGET_SIZE / 2;
      const x  = target.x - hs;
      const y  = target.y - hs;
      const ts = TARGET_SIZE;
      const r  = TARGET_BORDER_RADIUS;

      ctx.strokeStyle = target.hit ? HIT_BORDER : TARGET_BORDER;
      ctx.fillStyle   = target.hit ? HIT_FILL   : TARGET_FILL;
      ctx.lineWidth   = 2;

      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + ts - r, y);       ctx.quadraticCurveTo(x + ts, y,      x + ts, y + r);
      ctx.lineTo(x + ts, y + ts - r);  ctx.quadraticCurveTo(x + ts, y + ts, x + ts - r, y + ts);
      ctx.lineTo(x + r,  y + ts);      ctx.quadraticCurveTo(x,      y + ts, x,      y + ts - r);
      ctx.lineTo(x,      y + r);       ctx.quadraticCurveTo(x,      y,      x + r,  y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Checkmark
      if (target.hit) {
        ctx.strokeStyle = HIT_BORDER;
        ctx.lineWidth   = 2.5;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.beginPath();
        ctx.moveTo(x + ts * 0.22, y + ts * 0.50);
        ctx.lineTo(x + ts * 0.45, y + ts * 0.76);
        ctx.lineTo(x + ts * 0.80, y + ts * 0.22);
        ctx.stroke();
        ctx.lineCap   = 'butt';
        ctx.lineJoin  = 'miter';
      }
    });

    // 5. Score pop-ups
    popupsRef.current.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle   = HIT_BORDER;
      ctx.font        = 'bold 13px monospace';
      ctx.textAlign   = 'center';
      ctx.fillText('+1', p.x, p.y);
      ctx.restore();
    });

    // 6. Cursors — colored per index, visible on light canvas
    cursorsRef.current.forEach((cursor, idx) => {
      ctx.save();
      const color = CURSOR_COLORS[idx % CURSOR_COLORS.length];
      const sf    = CURSOR_SIZE / SVG_VIEWBOX_SIZE;
      ctx.translate(cursor.x - CURSOR_HOTSPOT_X * sf, cursor.y - CURSOR_HOTSPOT_Y * sf);
      ctx.scale(sf, sf);
      ctx.fillStyle   = color;
      ctx.fill(new Path2D(CURSOR_FILL_PATH));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2 / sf;
      ctx.stroke(new Path2D(CURSOR_STROKE_PATH));
      ctx.restore();
    });

    // 7. Paused overlay — light semi-transparent
    if (gameStateRef.current === 'paused') {
      ctx.fillStyle = 'rgba(248,250,252,0.88)';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.textAlign   = 'center';
      ctx.fillStyle   = '#1e293b';
      ctx.font        = `bold ${Math.round(W * 0.09)}px sans-serif`;
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.font        = `${Math.round(W * 0.033)}px sans-serif`;
      ctx.fillStyle   = '#64748b';
      ctx.fillText('Click Resume to continue', W / 2, H / 2 + Math.round(W * 0.08));
      ctx.restore();
    }
  }, []);

  // ─── Animation loop ─────────────────────────────────────────────────────
  const loop = useCallback((time: number) => {
    const dt = time - lastTimeRef.current;
    lastTimeRef.current = time;
    update(dt);
    draw();
    requestRef.current = requestAnimationFrame(loop);
  }, [update, draw]);

  // ─── Effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    const resize = () => {
      if (canvasRef.current?.parentElement) {
        const sz = Math.min(canvasRef.current.parentElement.clientWidth, CANVAS_MAX_WIDTH);
        canvasRef.current.width  = sz;
        canvasRef.current.height = Math.round(sz * 0.75);
        draw();
      }
    };
    window.addEventListener('resize', resize);
    resize();
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  useEffect(() => {
    lastTimeRef.current = performance.now();
    requestRef.current  = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [loop]);

  // Countdown timer
  useEffect(() => {
    if (gameState !== 'playing') return;
    const iv = setInterval(() => {
      timeRef.current -= 1;
      setDisplayTime(timeRef.current);
      if (timeRef.current <= 0) {
        gameStateRef.current = 'gameover';
        setGameState('gameover');
        const final = scoreRef.current;
        if (final > prevBestRef.current) {
          setIsNewBest(true);
          setBestScore(final);
          try { localStorage.setItem('tm_best', String(final)); } catch { /* ok */ }
        } else {
          setIsNewBest(false);
        }
        playSound('gameover');
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [gameState, playSound]);

  // ─── Level-up ───────────────────────────────────────────────────────────
  const levelUp = useCallback((nextLvl: number) => {
    levelRef.current       = nextLvl;
    cursorCountRef.current = nextLvl;
    setLevel(nextLvl);
    setCursorCount(nextLvl);
    setBannerLevel(nextLvl);
    setShowLevelBanner(true);
    playSound('levelup');
    initLevel(nextLvl);
    setTimeout(() => setShowLevelBanner(false), 1400);
  }, [playSound, initLevel]);

  // ─── Click handler ──────────────────────────────────────────────────────
  const handleClick = useCallback((_e: React.MouseEvent | React.TouchEvent) => {
    if (gameStateRef.current !== 'playing') return;
    for (const cursor of cursorsRef.current) {
      for (let i = targetsRef.current.length - 1; i >= 0; i--) {
        const t = targetsRef.current[i];
        if (t.hit) continue;
        const hs = TARGET_SIZE / 2;
        if (
          cursor.x + CURSOR_SIZE > t.x - hs &&
          cursor.x              < t.x + hs &&
          cursor.y + CURSOR_SIZE > t.y - hs &&
          cursor.y              < t.y + hs
        ) {
          t.hit = true;
          scoreRef.current += 1;
          setScore(scoreRef.current);
          playSound('hit');
          spawnParticles(t.x, t.y, HIT_BORDER);
          popupsRef.current.push({
            id:   Math.random().toString(36).substr(2, 6),
            x:    t.x, y: t.y - 12, life: 1,
          });
          const capturedTarget   = t;
          const capturedLevelRef = levelRef;
          setTimeout(() => {
            targetsRef.current = targetsRef.current.filter(x => x !== capturedTarget);
            if (targetsRef.current.length === 0) levelUp(capturedLevelRef.current + 1);
          }, 220);
        }
      }
    }
  }, [playSound, spawnParticles, levelUp]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = {
      x: Math.max(0, Math.min(canvas.width,  e.clientX - rect.left)),
      y: Math.max(0, Math.min(canvas.height, e.clientY - rect.top)),
    };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = {
      x: Math.max(0, Math.min(canvas.width,  e.touches[0].clientX - rect.left)),
      y: Math.max(0, Math.min(canvas.height, e.touches[0].clientY - rect.top)),
    };
  }, []);

  // ─── Game actions ────────────────────────────────────────────────────────
  const startGame = () => {
    scoreRef.current       = 0;
    levelRef.current       = 1;
    cursorCountRef.current = 1;
    prevBestRef.current    = bestScore;
    setScore(0); setLevel(1); setCursorCount(1);
    setIsNewBest(false); setShowLevelBanner(false);
    timeRef.current = selectedTime;
    setDisplayTime(selectedTime);
    particlesRef.current = []; popupsRef.current = [];
    if (canvasRef.current) {
      cursorsRef.current = [{ x: canvasRef.current.width / 2, y: canvasRef.current.height / 2 }];
    }
    initLevel(1);
    gameStateRef.current = 'playing';
    setGameState('playing');
  };

  const resetGame = () => {
    gameStateRef.current   = 'start';
    cursorCountRef.current = 1;
    levelRef.current       = 1;
    scoreRef.current       = 0;
    setGameState('start');
    setScore(0); setLevel(1); setCursorCount(1);
    setDisplayTime(selectedTime);
    timeRef.current = selectedTime;
    targetsRef.current  = []; cursorsRef.current  = [];
    particlesRef.current = []; popupsRef.current  = [];
    setShowLevelBanner(false); setIsNewBest(false);
  };

  // ─── Button style helpers ────────────────────────────────────────────────
  const primaryBtn: React.CSSProperties = {
    background:    '#2563eb',
    color:         '#ffffff',
    border:        '1px solid #1d4ed8',
    boxShadow:     '0 1px 3px rgba(37,99,235,0.3)',
  };
  const ghostBtn: React.CSSProperties = {
    background:    '#f8fafc',
    border:        '1px solid #e2e8f0',
    color:         '#475569',
  };
  const outlineBtn = (color: string, bg: string): React.CSSProperties => ({
    background:    bg,
    border:        `1px solid ${color}`,
    color:         color,
  });

  return (
    <div
      className="flex flex-col items-center justify-center w-full min-h-screen p-4 select-none"
      style={{ background: '#f1f5f9', fontFamily: "'Space Grotesk', sans-serif" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        className="w-full mb-4 flex items-center justify-between gap-3 rounded-2xl px-5 py-3"
        style={{ maxWidth: CANVAS_MAX_WIDTH, background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">☑</span>
          <div>
            <div className="font-bold text-lg leading-tight text-slate-800" style={{ fontFamily: 'monospace' }}>
              Task<span style={{ color: '#2563eb' }}>Master</span>
            </div>
            {bestScore > 0 && (
              <div className="text-xs text-slate-400">Best: {bestScore}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6">
          {[
            { value: score,            label: 'SCORE',   color: '#2563eb' },
            { value: level,            label: 'LEVEL',   color: '#7c3aed' },
            { value: `${displayTime}s`, label: 'TIME',   color: displayTime <= 10 ? '#dc2626' : '#ea580c', pulse: displayTime <= 10 },
            { value: cursorCount,      label: 'CURSORS', color: '#16a34a' },
          ].map(({ value, label, color, pulse }) => (
            <div key={label} className="text-center">
              <div
                className={`font-bold text-xl leading-none ${pulse ? 'animate-pulse' : ''}`}
                style={{ color, fontFamily: 'monospace' }}
              >
                {value}
              </div>
              <div className="text-xs mt-0.5 font-semibold tracking-wider text-slate-400">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <div
        className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden cursor-none"
        style={{ maxWidth: CANVAS_MAX_WIDTH, border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full touch-none"
          onMouseMove={handleMouseMove}
          onMouseDown={handleClick}
          onTouchMove={handleTouchMove}
          onTouchStart={e => { handleTouchMove(e); handleClick(e); }}
        />

        {/* Start screen */}
        <AnimatePresence>
          {gameState === 'start' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center z-10"
              style={{ background: 'rgba(241,245,249,0.92)', backdropFilter: 'blur(4px)' }}
            >
              <motion.div
                initial={{ scale: 0.9, y: 16 }} animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                className="text-center px-8 py-9 rounded-3xl"
                style={{ background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 8px 32px rgba(0,0,0,0.1)' }}
              >
                <div className="text-5xl mb-2 leading-none">☑</div>
                <h2 className="text-4xl font-black text-slate-800 mb-1 tracking-tight" style={{ fontFamily: 'monospace' }}>
                  Task<span style={{ color: '#2563eb' }}>Master</span>
                </h2>
                <p className="text-sm leading-relaxed mb-7 text-slate-500">
                  Move your cursor — multiple pointers follow.<br/>
                  Click to check boxes before time runs out!
                </p>

                <div className="mb-7">
                  <p className="text-xs uppercase tracking-widest mb-3 text-slate-400 font-semibold">Choose Duration</p>
                  <div className="flex gap-3 justify-center">
                    {([30, 60] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setSelectedTime(t)}
                        className="px-7 py-2 rounded-full font-bold text-sm transition-all hover:scale-105"
                        style={selectedTime === t ? outlineBtn('#2563eb', 'rgba(37,99,235,0.08)') : ghostBtn}
                      >
                        {t}s
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={startGame}
                  className="inline-flex items-center gap-2 px-9 py-3 rounded-full font-bold text-sm tracking-wider transition-all hover:scale-105 active:scale-95"
                  style={primaryBtn}
                >
                  <Play className="w-4 h-4 fill-current" /> START GAME
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Level-up banner */}
        <AnimatePresence>
          {showLevelBanner && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.92 }}
              animate={{ opacity: 1, y: 0,   scale: 1    }}
              exit={   { opacity: 0, y:  20, scale: 0.92 }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-6 py-2 rounded-full font-bold text-sm whitespace-nowrap"
              style={{ background: '#ede9fe', border: '1px solid #7c3aed', color: '#6d28d9', boxShadow: '0 2px 10px rgba(124,58,237,0.2)', fontFamily: 'monospace' }}
            >
              ⚡ LEVEL {bannerLevel} — +1 CURSOR
            </motion.div>
          )}
        </AnimatePresence>

        {/* Game-over screen */}
        <AnimatePresence>
          {gameState === 'gameover' && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center z-10"
              style={{ background: 'rgba(241,245,249,0.94)', backdropFilter: 'blur(4px)' }}
            >
              <motion.div
                initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                className="text-center px-8 py-9 rounded-3xl"
                style={{ background: '#ffffff', border: '1px solid #fecaca', boxShadow: '0 8px 32px rgba(220,38,38,0.1)' }}
              >
                <div className="text-2xl font-black text-slate-700 mb-0.5 tracking-widest" style={{ fontFamily: 'monospace' }}>
                  TIME'S UP
                </div>
                <div className="text-7xl font-black leading-none mb-1" style={{ color: '#2563eb', fontFamily: 'monospace' }}>
                  {score}
                </div>
                <div className="text-sm text-slate-500 mb-0.5">checkboxes in {selectedTime}s</div>
                <div className="text-xs text-slate-400 mb-5">Reached Level {level}</div>

                {isNewBest && score > 0 && (
                  <div
                    className="inline-block text-xs font-bold px-4 py-1.5 rounded-full mb-5"
                    style={{ background: '#fefce8', color: '#a16207', border: '1px solid #fde68a' }}
                  >
                    🏆 NEW BEST!
                  </div>
                )}
                {(!isNewBest || score === 0) && <div className="mb-5" />}

                <div className="flex gap-3 justify-center">
                  <button
                    onClick={startGame}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full font-bold text-sm transition-all hover:scale-105 active:scale-95"
                    style={primaryBtn}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Play Again
                  </button>
                  <button
                    onClick={resetGame}
                    className="px-6 py-2.5 rounded-full font-bold text-sm transition-all hover:scale-105 active:scale-95"
                    style={ghostBtn}
                  >
                    Change Time
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className="mt-4 flex gap-3" style={{ maxWidth: CANVAS_MAX_WIDTH }}>
        {gameState === 'playing' && (
          <button
            onClick={() => { gameStateRef.current = 'paused'; setGameState('paused'); }}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl font-medium text-sm transition-all hover:scale-105"
            style={ghostBtn}
          >
            <Pause className="w-4 h-4" /> Pause
          </button>
        )}
        {gameState === 'paused' && (
          <button
            onClick={() => { gameStateRef.current = 'playing'; setGameState('playing'); }}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm transition-all hover:scale-105"
            style={outlineBtn('#2563eb', 'rgba(37,99,235,0.07)')}
          >
            <Play className="w-4 h-4 fill-current" /> Resume
          </button>
        )}
        {(gameState === 'playing' || gameState === 'paused') && (
          <button
            onClick={resetGame}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl font-medium text-sm transition-all hover:scale-105"
            style={ghostBtn}
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
        )}
      </div>

      <div className="mt-3 text-xs text-center md:hidden text-slate-400">
        Tap to click · Drag to move cursors
      </div>
    </div>
  );
}
