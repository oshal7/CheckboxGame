import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  RotateCcw, 
  MousePointer2, 
  Clock, 
  Trophy, 
  Target 
} from 'lucide-react';
import { 
  getCursorTargetPosition, 
  getRandomInt, 
  TARGET_SIZE, 
  TARGET_BORDER_RADIUS, 
  CURSOR_SIZE, 
  HIT_COLOR, 
  TARGET_COLOR,
  GameCursor,
  GameTarget
} from '../utils/gameMath';
import { 
  CURSOR_FILL_PATH, 
  CURSOR_STROKE_PATH, 
  SVG_VIEWBOX_SIZE, 
  CURSOR_HOTSPOT_X, 
  CURSOR_HOTSPOT_Y 
} from '../utils/cursorIcons';

// Game Constants
const TARGET_INITIAL_SPEED = 1.5;
const TARGET_SPEED_BOUNCE_MULTIPLIER = 1.1;
const TARGET_MAX_SPEED = 6;
const INITIAL_TARGET_COUNT = 5;
// TIME_PER_LEVEL_INCREASE removed — timer runs continuously across levels

type GameState = 'start' | 'playing' | 'paused' | 'gameover';

export function TaskMasterGame() {
  // --- Refs for Game Engine (Mutable state for performance) ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const cursorsRef = useRef<GameCursor[]>([]);
  const targetsRef = useRef<GameTarget[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const timeRef = useRef<number>(60);
  const lastTimeRef = useRef<number>(0);
  
  // --- React State for UI ---
  const [gameState, setGameState] = useState<GameState>('start');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [displayTime, setDisplayTime] = useState(60);
  const [cursorCount, setCursorCount] = useState(1);
  const [levelTargetCount, setLevelTargetCount] = useState(INITIAL_TARGET_COUNT);
  const [targetsHitInLevel, setTargetsHitInLevel] = useState(0);
  const [selectedTime, setSelectedTime] = useState<30 | 60>(60);
  
  // --- Audio (Optional placeholder) ---
  // const playHitSound = () => { /* ... */ };

  // --- Game Loop ---
  const update = useCallback((deltaTime: number) => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // 1. Update Cursors
    // Primary cursor follows mouse
    const primaryPos = getCursorTargetPosition(
        0, 
        mouseRef.current.x, 
        mouseRef.current.y, 
        canvas.width, 
        canvas.height, 
        cursorCount
    );
    
    // Ensure we have enough cursor objects
    while (cursorsRef.current.length < cursorCount) {
        cursorsRef.current.push({ x: canvas.width / 2, y: canvas.height / 2 });
    }

    cursorsRef.current[0] = { x: primaryPos.x, y: primaryPos.y };

    // Update subsequent cursors
    for (let i = 1; i < cursorsRef.current.length; i++) {
      const newPos = getCursorTargetPosition(
        i, 
        mouseRef.current.x, // For >4, we need the raw mouse input for all
        mouseRef.current.y, // For <=4, existing logic handles it correctly
        canvas.width,
        canvas.height,
        cursorCount
      );
      
      // Simple easing for smooth movement could be added here, 
      // but original game used direct snapping for precision.
      // We will stick to snapping for the "Task Master" feel.
      cursorsRef.current[i] = { x: newPos.x, y: newPos.y };
    }

    // 2. Update Targets
    targetsRef.current.forEach(target => {
      if (target.hit) return; // Don't move hit targets (they fade out)

      target.x += target.vx;
      target.y += target.vy;

      let bounced = false;
      const r = TARGET_SIZE / 2;

      // Wall bouncing
      if (target.x - r < 0) {
        target.x = r;
        target.vx = Math.abs(target.vx) * TARGET_SPEED_BOUNCE_MULTIPLIER;
        bounced = true;
      } else if (target.x + r > canvas.width) {
        target.x = canvas.width - r;
        target.vx = -Math.abs(target.vx) * TARGET_SPEED_BOUNCE_MULTIPLIER;
        bounced = true;
      }

      if (target.y - r < 0) {
        target.y = r;
        target.vy = Math.abs(target.vy) * TARGET_SPEED_BOUNCE_MULTIPLIER;
        bounced = true;
      } else if (target.y + r > canvas.height) {
        target.y = canvas.height - r;
        target.vy = -Math.abs(target.vy) * TARGET_SPEED_BOUNCE_MULTIPLIER;
        bounced = true;
      }

      // Cap speed
      if (bounced) {
        const speed = Math.sqrt(target.vx * target.vx + target.vy * target.vy);
        if (speed > TARGET_MAX_SPEED) {
          const ratio = TARGET_INITIAL_SPEED / speed; // Reset to base speed if too fast? Or cap at max?
          // Original code resets to initial speed if > max.
          // Let's cap at max for smoother gameplay, or reset as per original logic.
          // Original: target.vx *= ratio; target.vy *= ratio;
          target.vx *= ratio;
          target.vy *= ratio;
        }
      }
    });

  }, [gameState, cursorCount]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Targets
    targetsRef.current.forEach(target => {
        // Skip rendering if it's been hit for a while (cleanup) - handled in click logic mainly
        // But we want to see them fade or disappear. 
        // For now, simpler: just don't draw if removed from array.
        // We actually modify the array in click handler, so just draw all in array.

        const halfSize = TARGET_SIZE / 2;
        const x = target.x - halfSize;
        const y = target.y - halfSize;
        const r = TARGET_BORDER_RADIUS;

        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1e293b'; // Slate-800

        // Draw Rounded Rect
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + TARGET_SIZE - r, y);
        ctx.quadraticCurveTo(x + TARGET_SIZE, y, x + TARGET_SIZE, y + r);
        ctx.lineTo(x + TARGET_SIZE, y + TARGET_SIZE - r);
        ctx.quadraticCurveTo(x + TARGET_SIZE, y + TARGET_SIZE, x + TARGET_SIZE - r, y + TARGET_SIZE);
        ctx.lineTo(x + r, y + TARGET_SIZE);
        ctx.quadraticCurveTo(x, y + TARGET_SIZE, x, y + TARGET_SIZE - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.stroke();

        if (target.hit) {
            ctx.fillStyle = HIT_COLOR;
            ctx.fill();
            // Checkmark
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x + TARGET_SIZE * 0.25, y + TARGET_SIZE * 0.5);
            ctx.lineTo(x + TARGET_SIZE * 0.45, y + TARGET_SIZE * 0.75);
            ctx.lineTo(x + TARGET_SIZE * 0.8, y + TARGET_SIZE * 0.25);
            ctx.stroke();
        } else {
            ctx.fillStyle = TARGET_COLOR;
            ctx.fill();
        }
    });

    // Draw Cursors
    cursorsRef.current.forEach((cursor) => {
        ctx.save();
        const scaleFactor = CURSOR_SIZE / SVG_VIEWBOX_SIZE;
        const tx = cursor.x - (CURSOR_HOTSPOT_X * scaleFactor);
        const ty = cursor.y - (CURSOR_HOTSPOT_Y * scaleFactor);
        
        ctx.translate(tx, ty);
        ctx.scale(scaleFactor, scaleFactor);

        // Fill
        ctx.fillStyle = '#0f172a'; // Slate-900
        const fillPath = new Path2D(CURSOR_FILL_PATH);
        ctx.fill(fillPath);

        // Stroke
        ctx.strokeStyle = '#f8fafc'; // Slate-50
        ctx.lineWidth = 1.5 / scaleFactor;
        const strokePath = new Path2D(CURSOR_STROKE_PATH);
        ctx.stroke(strokePath);

        ctx.restore();
    });

  }, []);

  const loop = useCallback((time: number) => {
    if (gameState === 'playing') {
        const deltaTime = time - lastTimeRef.current;
        lastTimeRef.current = time;
        update(deltaTime);
        draw();
    }
    requestRef.current = requestAnimationFrame(loop);
  }, [gameState, update, draw]);

  // --- Effects ---

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
        if (canvasRef.current && canvasRef.current.parentElement) {
            const container = canvasRef.current.parentElement;
            // Max width constraint
            const size = Math.min(container.clientWidth, 560);
            canvasRef.current.width = size;
            canvasRef.current.height = size * 0.75; // 4:3 Aspect Ratio
            // Initial draw to avoid blank screen
            if (gameState !== 'playing') draw();
        }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [draw, gameState]);

  // Start/Stop Loop
  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [loop]);

  // Timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (gameState === 'playing') {
        interval = setInterval(() => {
            timeRef.current -= 1;
            setDisplayTime(timeRef.current);
            if (timeRef.current <= 0) {
                setGameState('gameover');
            }
        }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState]);

  // --- Game Logic ---

  const initLevel = (lvl: number) => {
    // Reset targets
    const count = INITIAL_TARGET_COUNT + (lvl - 1) * 2;
    setLevelTargetCount(count);
    setTargetsHitInLevel(0);
    
    // Generate targets
    const canvas = canvasRef.current;
    if (!canvas) return;

    const newTargets: GameTarget[] = [];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        newTargets.push({
            id: Math.random().toString(36).substr(2, 9),
            x: getRandomInt(TARGET_SIZE, canvas.width - TARGET_SIZE),
            y: getRandomInt(TARGET_SIZE, canvas.height - TARGET_SIZE),
            vx: TARGET_INITIAL_SPEED * Math.cos(angle),
            vy: TARGET_INITIAL_SPEED * Math.sin(angle),
            hit: false
        });
    }
    targetsRef.current = newTargets;
  };

  const startGame = () => {
    setScore(0);
    setLevel(1);
    setCursorCount(1);
    timeRef.current = selectedTime;
    setDisplayTime(selectedTime);
    setGameState('playing');
    
    // Initialize cursors
    if (canvasRef.current) {
        cursorsRef.current = [{ 
            x: canvasRef.current.width / 2, 
            y: canvasRef.current.height / 2 
        }];
    }
    
    initLevel(1);
  };

  const resetGame = () => {
    setGameState('start');
    setScore(0);
    setLevel(1);
    setCursorCount(1);
    setDisplayTime(selectedTime);
    timeRef.current = selectedTime;
    targetsRef.current = [];
    cursorsRef.current = [];
  };

  const levelUp = () => {
    const nextLevel = level + 1;
    setLevel(nextLevel);
    setCursorCount(nextLevel);
    // No time bonus — timer runs continuously for the full selected duration
    initLevel(nextLevel);
  };

  const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing') return;

    // Handle touch/mouse unification
    let clientX, clientY;
    if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;

    // Although we have click coordinates, the game logic is: 
    // "Check if ANY cursor hits a target when the user clicks".
    // So we iterate through ALL cursors.

    let hitSomething = false;

    // Check collision for each cursor
    for (const cursor of cursorsRef.current) {
        const cursorLeft = cursor.x;
        const cursorRight = cursor.x + CURSOR_SIZE;
        const cursorTop = cursor.y;
        const cursorBottom = cursor.y + CURSOR_SIZE;

        for (let i = targetsRef.current.length - 1; i >= 0; i--) {
            const target = targetsRef.current[i];
            if (target.hit) continue;

            const targetLeft = target.x - TARGET_SIZE / 2;
            const targetRight = target.x + TARGET_SIZE / 2;
            const targetTop = target.y - TARGET_SIZE / 2;
            const targetBottom = target.y + TARGET_SIZE / 2;

            if (
                cursorRight > targetLeft &&
                cursorLeft < targetRight &&
                cursorBottom > targetTop &&
                cursorTop < targetBottom
            ) {
                // HIT!
                target.hit = true;
                setScore(s => s + 1); // +1 per checkbox so score = total checkboxes clicked
                hitSomething = true;
                
                // We need to track hits in level
                // We use a functional update for state, but we also need local tracking for the logic immediately
                // However, React state updates are async.
                // We'll rely on a ref or simple logic here.
                // Actually, let's update state and check in an effect? 
                // No, immediate feedback is better.
                
                const newHitCount = targetsHitInLevel + 1; // This is risky if multiple hits in one frame/click
                // Safer: calculate remaining targets
                const remaining = targetsRef.current.filter(t => !t.hit).length;
                
                // Remove target after delay (handled by cleanup filter below)
                // We just mark as hit for now so it draws checked.
                
                setTimeout(() => {
                   targetsRef.current = targetsRef.current.filter(t => t !== target);
                   // If all targets cleared (checking the ref length)
                   if (targetsRef.current.length === 0) {
                       levelUp();
                   }
                }, 200);

                // Since we splice/filter asynchronously, we might have a race condition if we use `targetsHitInLevel`.
                // Checking `remaining` is better.
                if (remaining === 0) {
                    // This logic is slightly flawed because we filter after timeout.
                    // Correct logic:
                    // If we just hit the last one...
                }
            }
        }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = {
        x: Math.max(0, Math.min(canvas.width, e.clientX - rect.left)),
        y: Math.max(0, Math.min(canvas.height, e.clientY - rect.top))
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    mouseRef.current = {
        x: Math.max(0, Math.min(canvas.width, e.touches[0].clientX - rect.left)),
        y: Math.max(0, Math.min(canvas.height, e.touches[0].clientY - rect.top))
    };
    // Prevent scrolling
    // e.preventDefault(); // React synthetic events don't support preventDefault passively sometimes, better to do in effect or CSS
  };

  return (
    <div className="flex flex-col items-center justify-center w-full min-h-screen bg-slate-100 p-4 font-sans text-slate-900 select-none">
      {/* Header / Stats */}
      <div className="w-full max-w-[560px] mb-6 flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Target className="w-8 h-8 text-blue-500" />
            Task Master
        </h1>
        
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm md:text-base font-semibold text-slate-600">
            <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                <span className="text-slate-900 text-lg">{score}</span>
                <span className="text-xs text-slate-400 font-normal">checked</span>
            </div>
            <div className="flex items-center gap-2">
                <span className="uppercase text-xs font-bold tracking-wider text-slate-400">Level</span>
                <span className="text-slate-900 text-lg">{level}</span>
            </div>
            <div className="flex items-center gap-2 min-w-[80px]">
                <Clock className="w-4 h-4 text-blue-400" />
                <span className={`text-lg ${displayTime <= 10 ? 'text-red-500 animate-pulse' : 'text-slate-900'}`}>
                    {displayTime}s
                </span>
            </div>
            <div className="flex items-center gap-2">
                <MousePointer2 className="w-4 h-4 text-purple-500" />
                <span className="text-slate-900 text-lg">{cursorCount}</span>
            </div>
        </div>
      </div>

      {/* Game Container */}
      <div className="relative w-full max-w-[560px] aspect-[4/3] bg-white rounded-xl shadow-lg border-2 border-slate-200 overflow-hidden cursor-none">
        <canvas
            ref={canvasRef}
            className="block w-full h-full touch-none"
            onMouseMove={handleMouseMove}
            onMouseDown={handleClick}
            onTouchMove={handleTouchMove}
            onTouchStart={(e) => {
                handleTouchMove(e);
                handleClick(e);
            }}
        />

        {/* Overlay: Start Screen */}
        <AnimatePresence>
            {gameState === 'start' && (
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-white z-10"
                >
                    <motion.div 
                        initial={{ scale: 0.9, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        className="text-center p-8"
                    >
                        <h2 className="text-4xl md:text-5xl font-bold mb-4">Task Master</h2>
                        <p className="text-slate-300 mb-6 max-w-md mx-auto text-lg leading-relaxed">
                            Control multiple cursors at once. <br/>
                            Click to complete tasks (checkboxes). <br/>
                            How many can you check in time?
                        </p>

                        {/* Time Selection */}
                        <div className="mb-8">
                            <p className="text-slate-400 text-sm uppercase tracking-wider mb-3">Choose Duration</p>
                            <div className="flex items-center justify-center gap-3">
                                <button
                                    onClick={() => setSelectedTime(30)}
                                    className={`px-6 py-3 rounded-full font-bold transition-all border-2 ${
                                        selectedTime === 30
                                            ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/30'
                                            : 'bg-white/10 border-white/20 text-slate-300 hover:bg-white/20'
                                    }`}
                                >
                                    30s
                                </button>
                                <button
                                    onClick={() => setSelectedTime(60)}
                                    className={`px-6 py-3 rounded-full font-bold transition-all border-2 ${
                                        selectedTime === 60
                                            ? 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/30'
                                            : 'bg-white/10 border-white/20 text-slate-300 hover:bg-white/20'
                                    }`}
                                >
                                    60s
                                </button>
                            </div>
                        </div>

                        <button 
                            onClick={startGame}
                            className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-bold rounded-full transition-all shadow-lg hover:shadow-blue-500/25 transform hover:-translate-y-1"
                        >
                            <Play className="w-5 h-5 fill-current" />
                            Start Game
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>

        {/* Overlay: Game Over */}
        <AnimatePresence>
            {gameState === 'gameover' && (
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }} 
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-red-900/90 backdrop-blur-sm flex flex-col items-center justify-center text-white z-10"
                >
                    <motion.div 
                        initial={{ scale: 0.9 }}
                        animate={{ scale: 1 }}
                        className="text-center p-8 bg-white/10 rounded-2xl border border-white/10 shadow-2xl"
                    >
                        <h2 className="text-4xl font-bold mb-2">Time's Up!</h2>
                        <div className="text-6xl font-black text-blue-300 mb-1">{score}</div>
                        <p className="text-slate-300 mb-1">checkboxes in {selectedTime}s</p>
                        <p className="text-slate-400 text-sm mb-8">Reached Level {level}</p>
                        
                        <div className="flex items-center justify-center gap-3">
                            <button 
                                onClick={startGame}
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white text-red-600 hover:bg-slate-100 font-bold rounded-full transition-colors shadow-lg"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Play Again
                            </button>
                            <button 
                                onClick={resetGame}
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/20 hover:bg-white/30 text-white font-bold rounded-full transition-colors"
                            >
                                Change Time
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
      </div>

      {/* Controls / Footer */}
      <div className="mt-6 flex gap-3">
        {gameState === 'playing' && (
             <button 
                onClick={() => setGameState('paused')}
                className="px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition-colors"
            >
                Pause
            </button>
        )}
        {gameState === 'paused' && (
             <button 
                onClick={() => setGameState('playing')}
                className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
            >
                Resume
            </button>
        )}
        {(gameState === 'playing' || gameState === 'paused') && (
            <button
                onClick={resetGame}
                className="inline-flex items-center gap-2 px-6 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg font-medium transition-colors"
            >
                <RotateCcw className="w-4 h-4" />
                Reset
            </button>
        )}
      </div>
      
      {/* Mobile Hint */}
      <div className="mt-4 text-xs text-slate-400 md:hidden text-center max-w-xs">
          Tip: Tap to click. Drag to move cursors.
      </div>

    </div>
  );
}