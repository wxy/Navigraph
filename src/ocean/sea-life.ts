import { drawSprite, type OceanArt } from './art.js';
import { OFFSHORE_TRAWLER } from './boats.js';
import type { Point, Waterways } from './course.js';

const DETAILS = [
  { kind: 'trawler', x: .24, y: .22, heading: -.32, drift: 13, period: 53 },
  { kind: 'whale', x: .56, y: .74, heading: -.5, drift: 25, period: 26 },
  { kind: 'gulls', x: .65, y: .20, heading: .5, drift: 12, period: 36 },
  { kind: 'trawler', x: .79, y: .60, heading: 2.7, drift: 10, period: 67 },
  { kind: 'gulls', x: .30, y: .80, heading: -.6, drift: 13, period: 42 },
  { kind: 'fish', x: .46, y: .48, heading: .24, drift: 29, period: 17 },
] as const;

const GULLS = [
  { x: 1, y: 0, width: 17, design: 0, phase: 0 },
  { x: -14, y: -10, width: 13, design: 3, phase: 2 },
  { x: -12, y: 11, width: 12, design: 0, phase: 3 },
];

type SeaDetail = (typeof DETAILS)[number] & { point: Point; scale: number };

export function placeSeaLife(water: Waterways, width: number, height: number): SeaDetail[] {
  const scale = width < 600 ? .78 : 1;
  const placed: SeaDetail[] = [];
  const candidates = DETAILS.map(detail => ({ x: detail.x * width, y: detail.y * height }));
  for (let column = 1; column <= 7; column++) {
    for (let row = 1; row <= 5; row++) candidates.push({ x: width * column / 8, y: height * row / 6 });
  }
  for (const detail of DETAILS) {
    const radius = (detail.drift + 25) * scale;
    const nearby = [...candidates].sort((a, b) =>
      Math.hypot(a.x - detail.x * width, a.y - detail.y * height) - Math.hypot(b.x - detail.x * width, b.y - detail.y * height));
    const point = nearby.find(point => water.openWater(point, radius)
      && placed.every(other => Math.hypot(point.x - other.point.x, point.y - other.point.y) > 72 * scale));
    if (point) placed.push({ ...detail, point, scale });
  }
  return placed;
}

export function drawSeaLife(ctx: CanvasRenderingContext2D, art: OceanArt, details: SeaDetail[], time: number): void {
  const seconds = time / 1000;
  for (const { point, kind, scale, heading, period, drift } of details) {
    const turn = seconds / period * Math.PI * 2;
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
    } else if (kind === 'trawler') {
      ctx.globalAlpha = .84;
      drawSprite(ctx, art.boats, OFFSHORE_TRAWLER, 0, 0, 38);
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
