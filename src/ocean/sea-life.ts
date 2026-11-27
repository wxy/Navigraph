import { drawSprite, type OceanArt } from './art.js';
import { OFFSHORE_TRAWLER } from './boats.js';
import type { Point, Waterways } from './course.js';

const DETAILS = [
  { kind: 'whale', drift: 25, period: 26 },
  { kind: 'fish', drift: 29, period: 17 },
  { kind: 'gulls', drift: 12, period: 36 },
  { kind: 'gulls', drift: 13, period: 42 },
  { kind: 'trawler', drift: 10, period: 67 },
  { kind: 'fishing', drift: 9, period: 53 },
] as const;

const GULLS = [
  { x: 1, y: 0, width: 17, design: 0, phase: 0 },
  { x: -14, y: -10, width: 13, design: 3, phase: 2 },
  { x: -12, y: 11, width: 12, design: 0, phase: 3 },
];

type SeaDetail = (typeof DETAILS)[number] & { point: Point; scale: number; heading: number; phase: number };

export function placeSeaLife(water: Waterways, width: number, height: number, seed: number): SeaDetail[] {
  const scale = width < 600 ? .78 : 1;
  const placed: SeaDetail[] = [];
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const detail of DETAILS) {
    const radius = (detail.drift + 25) * scale;
    const heading = random() * Math.PI * 2;
    const phase = random() * Math.PI * 2;
    for (let attempt = 0; attempt < 48; attempt++) {
      const point = { x: radius + random() * (width - 2 * radius), y: radius + random() * (height - 2 * radius) };
      if (!water.openWater(point, radius)
        || placed.some(other => Math.hypot(point.x - other.point.x, point.y - other.point.y) < 76 * scale)) continue;
      placed.push({ ...detail, point, scale, heading, phase });
      break;
    }
  }
  return placed;
}

export function drawSeaLife(ctx: CanvasRenderingContext2D, art: OceanArt, details: SeaDetail[], time: number): void {
  const seconds = time / 1000;
  for (const { point, kind, scale, heading, period, drift, phase } of details) {
    const turn = phase + seconds / period * Math.PI * 2;
    const swimming = kind === 'whale' || kind === 'fish';
    ctx.save();
    if (swimming) {
      const x = Math.sin(turn) * drift * scale;
      const y = -Math.cos(turn) * drift * scale * .55;
      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      ctx.translate(point.x + x * cos - y * sin, point.y + x * sin + y * cos);
      ctx.rotate(heading + Math.atan2(.55 * Math.sin(turn), Math.cos(turn)));
    } else {
      ctx.translate(point.x + Math.sin(turn) * drift * scale, point.y + Math.sin(turn * 2) * drift * scale * .35);
      ctx.rotate(heading + Math.sin(turn) * .14);
    }
    ctx.scale(scale, scale);
    if (swimming) {
      ctx.globalAlpha = .70 + Math.sin(turn) * .08;
      drawSprite(ctx, art.marine, kind === 'whale' ? 0 : 2, 0, 0, kind === 'whale' ? 47 : 32);
    } else if (kind === 'trawler' || kind === 'fishing') {
      ctx.globalAlpha = .84;
      drawSprite(ctx, art.boats, kind === 'trawler' ? OFFSHORE_TRAWLER : 5, 0, 0, kind === 'trawler' ? 38 : 31);
    } else {
      ctx.globalAlpha = .90;
      for (const { x, y, width, design, phase } of GULLS) {
        const span = .91 + Math.sin(seconds * 4.4 + phase) * .09;
        drawSprite(ctx, art.birds, design, x, y, width, width * span);
      }
    }
    ctx.restore();
  }
}
