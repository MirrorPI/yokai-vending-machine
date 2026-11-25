export const arena = { width: 192, height: 160 } as const;
export type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function flameShape(motion: Point) {
  const x = clamp(motion.x, -1, 1);
  const y = clamp(motion.y, -1, 1);
  return {
    width: 1 - y * .10,
    height: 1 + y * .14,
    tailX: -x * 17,
    tailRise: 15 + y * 10 - Math.abs(x) * 5,
  };
}

// Each leg eases to a stop at its peak, so changing the next duration never snaps the wind.
export function createRoundWind(random = Math.random) {
  const strength = () => .42 + random() * .35;
  let from = 0;
  let to = (random() < .5 ? -1 : 1) * strength();
  const calmDuration = 8 + random() * 4;
  let start = calmDuration;
  let end = start + 2 + random() * 2;
  return (elapsed: number) => {
    if (elapsed <= calmDuration) return 0;
    while (elapsed >= end) {
      start = end;
      from = to;
      to = -Math.sign(from) * strength();
      end += 5 + random() * 4;
    }
    const progress = (elapsed - start) / (end - start);
    return from + (to - from) * (1 - Math.cos(Math.PI * progress)) / 2;
  };
}

export function rainMotion(elapsed: number, tilt: number) {
  const ramp = clamp(elapsed / 60, 0, 1);
  const speed = 88 * (1 + ramp * 1.1);
  const x = -Math.sin(tilt) * speed;
  const y = Math.cos(tilt) * speed;
  // Replace drops as they leave the arena, including those swept through the sides.
  const targetDrops = 7 + 18 * ramp;
  const rate = targetDrops * (y / arena.height + Math.abs(x) / arena.width);
  return { x, y, rate };
}

interface Drop extends Point { dx: number; dy: number; speedScale: number }

export function makeDrop(rain: ReturnType<typeof rainMotion>): Drop {
  const sideFlux = Math.abs(rain.x) * arena.height;
  const enterFromSide = Math.random() < sideFlux / (sideFlux + rain.y * arena.width);
  const speedScale = .9 + Math.random() * .23;
  return {
    x: enterFromSide ? (rain.x > 0 ? -3 : arena.width + 3) : Math.random() * arena.width,
    y: enterFromSide ? Math.random() * arena.height : -4,
    dx: rain.x * speedScale, dy: rain.y * speedScale, speedScale,
  };
}

export function advanceRain(drops: Drop[], seconds: number) {
  return drops.filter(drop => {
    drop.x += drop.dx * seconds;
    drop.y += drop.dy * seconds;
    return drop.y < arena.height + 22 && drop.x > -24 && drop.x < arena.width + 24;
  });
}

export function rainImpact(drops: Drop[], from: Point, to: Point, seconds: number) {
  let earliest: number | null = null;
  for (const drop of drops) {
    // Only the bright head of a drop can hit the round base of the flame.
    const x = (drop.x - from.x) / 7.5;
    const y = (drop.y - from.y) / 5;
    const dx = (drop.dx * seconds - (to.x - from.x)) / 7.5;
    const dy = (drop.dy * seconds - (to.y - from.y)) / 5;
    const distance = x * x + y * y - 1;
    if (distance <= 0) return 0;
    const speed = dx * dx + dy * dy;
    const approach = x * dx + y * dy;
    const discriminant = approach * approach - speed * distance;
    if (!speed || approach >= 0 || discriminant < 0) continue;
    const impact = (-approach - Math.sqrt(discriminant)) / speed;
    if (impact >= 0 && impact <= 1) earliest = Math.min(earliest ?? impact, impact);
  }
  return earliest;
}

export function drawRain(ctx: CanvasRenderingContext2D, drops: Drop[]) {
  for (const drop of drops) {
    for (let i = 0; i <= 9; i++) {
      const fade = i / 9;
      ctx.fillStyle = i < 2 ? '#b1eff8' : i < 5 ? '#6297ad' : '#37617a';
      ctx.fillRect(Math.round(drop.x - drop.dx * .06 * fade), Math.round(drop.y - drop.dy * .06 * fade), i === 0 ? 2 : 1, 2);
    }
  }
}

// Horizontal spans, drawn from the rounded base upward into the flame.
const flameLayers = [
  {
    color: '#397bc9', firstRow: 0, spans: [
      [-3, 3], [-5, 5], [-6, 6], [-7, 7], [-8, 8], [-8, 8], [-8, 8],
      [-7, 8], [-7, 7], [-7, 6], [-8, 5], [-8, 4], [-7, 3],
      [-7, 2], [-6, 1], [-5, 0], [-4, 0], [-4, -1], [-4, -2], [-3, -2], [-2, -2],
    ],
  },
  {
    color: '#59c4f2', firstRow: 1, spans: [
      [-3, 3], [-5, 5], [-6, 6], [-7, 7], [-7, 7], [-7, 7], [-6, 7],
      [-6, 6], [-6, 5], [-7, 4], [-7, 3], [-6, 2],
      [-6, 1], [-5, 0], [-4, -1], [-3, -1], [-3, -2], [-3, -3],
    ],
  },
  {
    color: '#a1ecfa', firstRow: 2, spans: [
      [-2, 2], [-4, 4], [-5, 5], [-6, 6], [-6, 6], [-6, 6],
      [-5, 5], [-5, 4], [-5, 3], [-5, 2], [-5, 1],
      [-4, 0], [-3, -1], [-3, -1], [-2, -2],
    ],
  },
  {
    color: '#e5fff8', firstRow: 3, spans: [
      [-2, 2], [-4, 3], [-5, 4], [-5, 5], [-5, 5], [-4, 4],
      [-4, 3], [-4, 2], [-4, 1], [-3, 0], [-3, -1], [-2, -2],
    ],
  },
];

function drawFireBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shape: ReturnType<typeof flameShape>,
  time: number,
) {
  const stretch = (shape.tailRise + Math.sin(time * 13) * 1.8) / 15;
  const toY = (row: number) => Math.round(y + (6 - Math.min(row, 10)) * shape.height - Math.max(0, row - 10) * stretch);

  for (const { color, firstRow, spans } of flameLayers) {
    ctx.fillStyle = color;
    for (const [index, [left, right]] of spans.entries()) {
      const row = firstRow + index;
      const rise = Math.max(0, row - 6) / 14;
      const sway = Math.sin(time * 11 - rise * 3) * 2.5 * rise;
      const center = x + Math.round(shape.tailX * rise ** 1.4 + sway);
      const start = center + Math.round(left * shape.width);
      const end = center + Math.round(right * shape.width);
      const top = toY(row + 1);
      ctx.fillRect(start, top, end - start + 1, toY(row) - top);
    }
  }
}

function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, tick: number) {
  const blink = tick % 46 >= 44;
  ctx.fillStyle = '#203354';
  ctx.fillRect(x - 3, y, 1, blink ? 1 : 2);
  ctx.fillRect(x + 3, y, 1, blink ? 1 : 2);
  ctx.fillRect(x, y + 2, 1, 1);
  ctx.fillStyle = '#ecaad2';
  ctx.fillRect(x - 5, y + 2, 1, 1);
  ctx.fillRect(x + 5, y + 2, 1, 1);
}

function pixelDisc(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  for (let row = -Math.floor(ry); row <= Math.floor(ry); row++) {
    const half = Math.max(0, Math.floor(rx * Math.sqrt(1 - (row / ry) ** 2)));
    ctx.fillRect(Math.round(x) - half, Math.round(y) + row, half * 2 + 1, 1);
  }
}

export function drawFlame(ctx: CanvasRenderingContext2D, point: Point, motion: Point, time: number, extinguish: number | null) {
  if (extinguish !== null) {
    const shrink = 1 - clamp(extinguish / .44, 0, 1);
    if (shrink > 0) pixelDisc(ctx, point.x, point.y, 2 + 5 * shrink, 1 + 3 * shrink, '#70cce7');
    for (let i = 0; i < 5; i++) {
      const life = clamp(extinguish / 1.05, 0, 1);
      ctx.globalAlpha = (1 - life) * .72;
      pixelDisc(ctx, point.x + (i - 2) * (1 + life * 3), point.y - 4 - life * (12 + i * 3), 1 + life * 3, 1 + life * 2, '#bccdeb');
    }
    ctx.globalAlpha = 1;
    return;
  }

  const shape = flameShape(motion);
  const tick = Math.floor(time * 12);
  const sway = Math.sin(time * 13) * 3;
  const x = Math.round(point.x);
  const y = Math.round(point.y + (tick % 8 < 4 ? 0 : 1) * (1 - Math.min(1, Math.hypot(motion.x, motion.y))));
  ctx.globalAlpha = .14;
  pixelDisc(ctx, x + shape.tailX * .22, y - 5, 12, 12, '#3296ed');
  ctx.globalAlpha = 1;
  drawFireBody(ctx, x, y, shape, time);
  drawFace(ctx, x, y, tick);
  for (let i = 0; i < 2; i++) {
    const life = (time * 1.8 + i * .5) % 1;
    ctx.fillStyle = life < .5 ? '#aff0fb' : '#509edd';
    ctx.fillRect(
      Math.round(x + shape.tailX * life + (i ? 6 : -5) + sway),
      Math.round(y - 8 - life * (shape.tailRise + 5)),
      1,
      life < .5 ? 2 : 1,
    );
  }
}
