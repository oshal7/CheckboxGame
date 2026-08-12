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
const TARGET_INITIAL_SPEED = 1.5;
const TARGET_SPEED_BOUNCE_MULTIPLIER = 1.1;
const TARGET_MAX_SPEED = 6;
const INITIAL_TARGET_COUNT = 5;

// Neon color palette — one per cursor index
const CURSOR_COLORS = ['#00e5ff', '#b146ff', '#ff6b35', '#ff006e', '#00ff88', '#ffd700'];

type GameState = 'start' | 'playing' | 'paused' | 'gameover';

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; // 1 → 0
  color: string;
  size: number;
}

interface ScorePopup {
  id: string;
  x: number; y: number;
  life: number; // 1 → 0
}

export function TaskMasterGame() {
  // ─── Engine refs (never cause re-renders) ───────────────────────────────
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

  // ─── React state (drives the UI) ───────────────────────────────────────
  const [gameState, setGameState]     = useState<GameState>('start');
  const [score, setScore]             = useState(0);
  const [level, setLevel]             = useState(1);
  const [displayTime, setDisplayTime] = useState(60);
  const [cursorCount, setCursorCount] = useState(1);
  const [selectedTime, setSelectedTime] = useState<30 | 60>(60);
  const [showLevelBanner, setShowLevelBanner] = useState(false);
  const [bannerLevel, setBannerLevel] = useState(2);
  const [isNewBest, setIsNewBest]     = useState(false);
  const [bestScore, setBestScore]     = useState(() => {
    try { return parseInt(localStorage.getItem('tm_best') || '0'); } catch { return 0; }
  });

  // Keep refs in sync with React state
  useEffect(() => { gameStateRef.current   = gameState;   }, [gameState]);
  useEffect(() => { cursorCountRef.current = cursorCount; }, [cursorCount]);
  useEffect(() => { levelRef.current       = level;       }, [level]);

  // ─── Audio (Web Audio API — no external files) ─────────────────────────
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
        g.gain.setValueAtTime(0.1, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        o.start(now); o.stop(now + 0.12);

      } else if (type === 'levelup') {
        [523, 659, 784, 1047].forEach((freq, i) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = 'sine'; o.frequency.value = freq;
          const t = now + i * 0.1;
          g.gain.setValueAtTime(0.12, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
          o.start(t); o.stop(t + 0.15);
        });

      } else {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(440, now);
        o.frequency.exponentialRampToValueAtTime(110, now + 0.5);
        g.gain.setValueAtTime(0.15, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        o.start(now); o.stop(now + 0.6);
      }
    } catch { /* AudioContext blocked — silently skip */ }
  }, []);

  // ─── Particle helpers ──────────────────────────────────────────────────
  const spawnParticles = useCallback((x: number, y: number, color: string) => {
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 1.5 + Math.random() * 3;
      particlesRef.current.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 1,
        color,
        size: 3 + Math.random() * 3,
      });
    }
  }, []);

  // ─── Level initialisation ──────────────────────────────────────────────
  const initLevel = useCallback((lvl: number) => {
    const count = INITIAL_TARGET_COUNT + (lvl - 1) * 2;
    const canvas = canvasRef.current;
    if (!canvas) return;
    targetsRef.current = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      return {
        id: Math.random().toString(36).substr(2, 9),
        x: getRandomInt(TARGET_SIZE * 2, canvas.width  - TARGET_SIZE * 2),
        y: getRandomInt(TARGET_SIZE * 2, canvas.height - TARGET_SIZE * 2),
        vx: TARGET_INITIAL_SPEED * Math.cos(angle),
        vy: TARGET_INITIAL_SPEED * Math.sin(angle),
        hit: false,
      };
    });
  }, []);

  // ─── Game-loop: update ─────────────────────────────────────────────────
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
      if (t.x - r < 0)             { t.x = r;                t.vx =  Math.abs(t.vx) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      else if (t.x + r > canvas.width)  { t.x = canvas.width  - r; t.vx = -Math.abs(t.vx) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      if (t.y - r < 0)             { t.y = r;                t.vy =  Math.abs(t.vy) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      else if (t.y + r > canvas.height) { t.y = canvas.height - r; t.vy = -Math.abs(t.vy) * TARGET_SPEED_BOUNCE_MULTIPLIER; bounced = true; }
      if (bounced) {
        const sp = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
        if (sp > TARGET_MAX_SPEED) { const ratio = TARGET_INITIAL_SPEED / sp; t.vx *= ratio; t.vy *= ratio; }
      }
    });

    // Clamp delta to avoid huge jumps after tab switching
    const dt = Math.min(deltaTime, 50) / 16;
    particlesRef.current = particlesRef.current.filter(p => {
      p.life -= 0.028 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.06 * dt;
      return p.life > 0;
    });
    popupsRef.current = popupsRef.current.filter(p => {
      p.life -= 0.022 * dt; p.y -= 0.55 * dt;
      return p.life > 0;
    });
  }, []);

  // ─── Game-loop: draw ───────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    // 1. Dark gradient background
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#10103a');
    bg.addColorStop(1, '#050510');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 2. Subtle grid
    ctx.strokeStyle = 'rgba(60,60,180,0.07)';
    ctx.lineWidth = 0.5;
    const gs = 32;
    for (let x = 0; x <= W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // 3. Particles
    particlesRef.current.forEach(p => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.shadowColor = p.color; ctx.shadowBlur = 8;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0, p.size * p.life), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 4. Targets
    targetsRef.current.forEach(target => {
      ctx.save();
      const hs = TARGET_SIZE / 2;
      const x = target.x - hs, y = target.y - hs;
      const ts = TARGET_SIZE, r = TARGET_BORDER_RADIUS;
      const col = target.hit ? '#00ff88' : '#00e5ff';

      ctx.shadowColor = col;
      ctx.shadowBlur  = target.hit ? 22 : 12;
      ctx.strokeStyle = col;
      ctx.fillStyle   = target.hit ? 'rgba(0,255,136,0.22)' : 'rgba(0,229,255,0.08)';
      ctx.lineWidth   = 2;

      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + ts - r, y);     ctx.quadraticCurveTo(x + ts, y,      x + ts, y + r);
      ctx.lineTo(x + ts, y + ts - r); ctx.quadraticCurveTo(x + ts, y + ts, x + ts - r, y + ts);
      ctx.lineTo(x + r,  y + ts);    ctx.quadraticCurveTo(x,      y + ts, x,      y + ts - r);
      ctx.lineTo(x,      y + r);     ctx.quadraticCurveTo(x,      y,      x + r,  y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (target.hit) {
        ctx.shadowBlur  = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.moveTo(x + ts * 0.22, y + ts * 0.50);
        ctx.lineTo(x + ts * 0.45, y + ts * 0.76);
        ctx.lineTo(x + ts * 0.80, y + ts * 0.22);
        ctx.stroke();
      }
      ctx.restore();
    });

    // 5. Score pop-ups (+1 floating text)
    popupsRef.current.forEach(p => {
      ctx.save();
      ctx.globalAlpha  = Math.max(0, p.life);
      ctx.shadowColor  = '#00ff88'; ctx.shadowBlur = 8;
      ctx.fillStyle    = '#00ff88';
      ctx.font         = 'bold 13px monospace';
      ctx.textAlign    = 'center';
      ctx.fillText('+1', p.x, p.y);
      ctx.restore();
    });

    // 6. Cursors (each a distinct neon colour)
    cursorsRef.current.forEach((cursor, idx) => {
      ctx.save();
      const color = CURSOR_COLORS[idx % CURSOR_COLORS.length];
      const sf = CURSOR_SIZE / SVG_VIEWBOX_SIZE;
      ctx.translate(cursor.x - CURSOR_HOTSPOT_X * sf, cursor.y - CURSOR_HOTSPOT_Y * sf);
      ctx.scale(sf, sf);
      ctx.shadowColor = color;
      ctx.shadowBlur  = 18 / sf;
      ctx.fillStyle   = color;
      ctx.fill(new Path2D(CURSOR_FILL_PATH));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.5 / sf;
      ctx.stroke(new Path2D(CURSOR_STROKE_PATH));
      ctx.restore();
    });

    // 7. Paused overlay
    if (gameStateRef.current === 'paused') {
      ctx.fillStyle = 'rgba(5,5,20,0.8)';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 24;
      ctx.fillStyle   = '#00e5ff';
      ctx.font = `bold ${Math.round(W * 0.1)}px monospace`;
      ctx.fillText('PAUSED', W / 2, H / 2);
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = 'rgba(150,180,255,0.65)';
      ctx.font = `${Math.round(W * 0.034)}px sans-serif`;
      ctx.fillText('Click Resume to continue', W / 2, H / 2 + Math.round(W * 0.085));
      ctx.restore();
    }
  }, []);

  // ─── Animation loop ────────────────────────────────────────────────────
  const loop = useCallback((time: number) => {
    const dt = time - lastTimeRef.current;
    lastTimeRef.current = time;
    update(dt);
    draw();
    requestRef.current = requestAnimationFrame(loop);
  }, [update, draw]);

  // ─── Effects ───────────────────────────────────────────────────────────
  useEffect(() => {
    const resize = () => {
      if (canvasRef.current?.parentElement) {
        const sz = Math.min(canvasRef.current.parentElement.clientWidth, 560);
        canvasRef.current.width  = sz;
        canvasRef.current.height = sz * 0.75;
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
        // Persist best score
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

  // ─── Level-up (callable from setTimeout — reads refs, not stale state) ─
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

  // ─── Click / touch handler ─────────────────────────────────────────────
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
          spawnParticles(t.x, t.y, '#00ff88');
          popupsRef.current.push({
            id: Math.random().toString(36).substr(2, 6),
            x: t.x, y: t.y - 12, life: 1,
          });
          const capturedTarget = t;
          const capturedLevelRef = levelRef;
          setTimeout(() => {
            targetsRef.current = targetsRef.current.filter(x => x !== capturedTarget);
            if (targetsRef.current.length === 0) {
              levelUp(capturedLevelRef.current + 1);
            }
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

  // ─── Game actions ──────────────────────────────────────────────────────
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

  // ─── Inline style tokens ───────────────────────────────────────────────
  const glass = {
    background:     'rgba(12,12,38,0.88)',
    border:         '1px solid rgba(0,229,255,0.14)',
    backdropFilter: 'blur(12px)',
    boxShadow:      '0 0 30px rgba(0,80,200,0.1)',
  } as React.CSSProperties;

  const neonBtn = (color: string) => ({
    background:  `rgba(${hexToRgb(color)},0.15)`,
    border:      `1px solid ${color}`,
    color:       color,
    boxShadow:   `0 0 18px rgba(${hexToRgb(color)},0.35)`,
  } as React.CSSProperties);

  const ghostBtn = {
    background: 'rgba(255,255,255,0.06)',
    border:     '1px solid rgba(255,255,255,0.13)',
    color:      'rgba(200,210,255,0.7)',
  } as React.CSSProperties;

  return (
    <div
      className="flex flex-col items-center justify-center w-full min-h-screen p-4 select-none"
      style={{ background: 'linear-gradient(135deg,#07071a 0%,#0d0a28 50%,#07071a 100%)', fontFamily: "'Space Grotesk', sans-serif" }}
    >
      {/* ── Header / Stats ─────────────────────────────────────────────── */}
      <div className="w-full max-w-[560px] mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={glass}>
        <div className="flex items-center gap-2.5">
          <div className="text-2xl leading-none" style={{ filter: 'drop-shadow(0 0 8px #00e5ff)' }}>☑</div>
          <div>
            <div className="font-bold text-lg leading-tight text-white" style={{ fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
              Task<span style={{ color: '#00e5ff' }}>Master</span>
            </div>
            {bestScore > 0 && (
              <div className="text-xs" style={{ color: 'rgba(150,180,255,0.55)' }}>Best: {bestScore}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          {[
            { value: score,       label: 'SCORE',   color: '#00e5ff' },
            { value: level,       label: 'LEVEL',   color: '#b146ff' },
            { value: `${displayTime}s`, label: 'TIME', color: displayTime <= 10 ? '#ff006e' : '#ff6b35', pulse: displayTime <= 10 },
            { value: cursorCount, label: 'CURSORS', color: '#00ff88' },
          ].map(({ value, label, color, pulse }) => (
            <div key={label} className="text-center">
              <div
                className={`font-bold text-xl leading-none ${pulse ? 'animate-pulse' : ''}`}
                style={{ color, fontFamily: 'monospace', textShadow: `0 0 10px ${color}55` }}
              >
                {value}
              </div>
              <div className="text-xs mt-0.5 font-medium tracking-wider" style={{ color: 'rgba(130,150,210,0.5)' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Game Canvas ────────────────────────────────────────────────── */}
      <div
        className="relative w-full max-w-[560px] aspect-[4/3] rounded-2xl overflow-hidden cursor-none"
        style={{ border: '1px solid rgba(0,229,255,0.18)', boxShadow: '0 0 60px rgba(0,70,200,0.18), 0 0 120px rgba(100,0,200,0.08)' }}
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
              style={{ background: 'rgba(4,4,18,0.93)', backdropFilter: 'blur(4px)' }}
            >
              <motion.div
                initial={{ scale: 0.88, y: 20 }} animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                className="text-center px-8 py-9 rounded-3xl"
                style={{ background: 'rgba(10,10,34,0.95)', border: '1px solid rgba(0,229,255,0.18)', boxShadow: '0 0 70px rgba(0,80,220,0.22)' }}
              >
                <div className="text-5xl mb-2 leading-none" style={{ filter: 'drop-shadow(0 0 12px #00e5ff)' }}>☑</div>
                <h2 className="text-4xl font-black text-white mb-1 tracking-tight" style={{ fontFamily: 'monospace' }}>
                  Task<span style={{ color: '#00e5ff' }}>Master</span>
                </h2>
                <p className="text-sm leading-relaxed mb-7" style={{ color: 'rgba(150,180,255,0.65)' }}>
                  Move your cursor — multiple pointers follow.<br/>
                  Click to check boxes before time runs out!
                </p>

                <div className="mb-7">
                  <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(110,130,190,0.55)' }}>Choose Duration</p>
                  <div className="flex gap-3 justify-center">
                    {([30, 60] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setSelectedTime(t)}
                        className="px-7 py-2 rounded-full font-bold text-sm transition-all"
                        style={selectedTime === t ? neonBtn('#00e5ff') : ghostBtn}
                      >
                        {t}s
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={startGame}
                  className="inline-flex items-center gap-2 px-9 py-3 rounded-full font-bold text-sm tracking-wider transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: '#000a1a', boxShadow: '0 0 32px rgba(0,220,255,0.45)', letterSpacing: '0.06em' }}
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
              initial={{ opacity: 0, y: -24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0,   scale: 1    }}
              exit={   { opacity: 0, y:  24, scale: 0.9  }}
              className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-6 py-2 rounded-full font-bold text-sm whitespace-nowrap"
              style={{ background: 'rgba(177,70,255,0.18)', border: '1px solid #b146ff', color: '#b146ff', boxShadow: '0 0 22px rgba(177,70,255,0.45)', fontFamily: 'monospace' }}
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
              style={{ background: 'rgba(4,4,18,0.94)', backdropFilter: 'blur(4px)' }}
            >
              <motion.div
                initial={{ scale: 0.88 }} animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                className="text-center px-8 py-9 rounded-3xl"
                style={{ background: 'rgba(10,10,34,0.97)', border: '1px solid rgba(255,0,110,0.25)', boxShadow: '0 0 70px rgba(200,0,100,0.18)' }}
              >
                <div className="text-2xl font-black text-white mb-0.5 tracking-widest" style={{ fontFamily: 'monospace' }}>TIME'S UP</div>
                <div
                  className="text-7xl font-black leading-none mb-1"
                  style={{ color: '#00e5ff', fontFamily: 'monospace', textShadow: '0 0 36px rgba(0,229,255,0.55)' }}
                >
                  {score}
                </div>
                <div className="text-sm mb-0.5" style={{ color: 'rgba(150,180,255,0.6)' }}>checkboxes in {selectedTime}s</div>
                <div className="text-xs mb-5" style={{ color: 'rgba(120,140,200,0.5)' }}>Reached Level {level}</div>

                {isNewBest && score > 0 && (
                  <div
                    className="inline-block text-xs font-bold px-4 py-1.5 rounded-full mb-5"
                    style={{ background: 'rgba(255,215,0,0.12)', color: '#ffd700', border: '1px solid rgba(255,215,0,0.3)', boxShadow: '0 0 16px rgba(255,215,0,0.25)' }}
                  >
                    🏆 NEW BEST!
                  </div>
                )}
                {(!isNewBest || score === 0) && <div className="mb-5" />}

                <div className="flex gap-3 justify-center">
                  <button
                    onClick={startGame}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full font-bold text-sm tracking-wide transition-all hover:scale-105 active:scale-95"
                    style={{ background: 'linear-gradient(135deg,#00e5ff,#0055ff)', color: '#000a1a', boxShadow: '0 0 22px rgba(0,220,255,0.38)' }}
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

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="mt-4 flex gap-3">
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
            style={neonBtn('#00e5ff')}
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

      <div className="mt-3 text-xs text-center md:hidden" style={{ color: 'rgba(110,130,190,0.4)' }}>
        Tap to click · Drag to move cursors
      </div>
    </div>
  );
}

// Helper: convert #rrggbb → "r,g,b" for CSS rgba()
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
