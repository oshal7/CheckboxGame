// Constants
export const TARGET_SIZE = 30; // Size of the square target (width/height)
export const TARGET_BORDER_RADIUS = 5; // Rounded corners for targets
export const CURSOR_SIZE = 40; // Size of the square cursor (width/height)
export const HIT_COLOR = '#00ff88'; // Neon green for hit targets
export const TARGET_COLOR = '#00e5ff'; // Neon cyan for targets

// Cursor positioning and spreading constants
export const CURSOR_SPIRAL_BASE_RADIUS = 60; 
export const CURSOR_SPIRAL_RADIUS_INCREMENT = 25; 
export const CURSOR_SPIRAL_ANGLE_INCREMENT = 0.618034 * Math.PI * 2; // Golden angle

// Mirroring modes for cursors relative to their base point
export const MIRROR_MODES = [
  { x: -1, y: 1 }, // Mirror horizontally
  { x: 1, y: -1 }, // Mirror vertically
  { x: -1, y: -1 }, // Mirror across both axes
  { x: 1, y: 1 }   // No mirroring
];

export interface Point {
  x: number;
  y: number;
}

export interface Vector {
  vx: number;
  vy: number;
}

export interface GameCursor extends Point {}

export interface GameTarget extends Point, Vector {
  id: string;
  hit: boolean;
  hitTime?: number; // Timestamp when hit for animation
}

/**
 * Generates a random integer within a range.
 */
export function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random float within a range.
 */
export function getRandomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Calculates the target position for a specific cursor based on index and primary cursor position.
 */
export function getCursorTargetPosition(
  index: number, 
  baseInputX: number, 
  baseInputY: number,
  canvasWidth: number,
  canvasHeight: number,
  totalCursors: number
): Point {
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  const dx = baseInputX - centerX;
  const dy = baseInputY - centerY;
  const radius = Math.sqrt(dx * dx + dy * dy);
  const baseAngle = Math.atan2(dy, dx);

  // Always use radial distribution — evenly space all cursors around a circle
  // Index 0 aligns with the mouse direction; others are offset equally
  const angleOffset = (index * 2 * Math.PI) / totalCursors;
  const angle = baseAngle + angleOffset;

  let targetX = centerX + radius * Math.cos(angle);
  let targetY = centerY + radius * Math.sin(angle);

  // Ensure cursors stay within canvas bounds
  targetX = Math.max(0, Math.min(canvasWidth - CURSOR_SIZE, targetX));
  targetY = Math.max(0, Math.min(canvasHeight - CURSOR_SIZE, targetY));

  return { x: targetX, y: targetY };
}