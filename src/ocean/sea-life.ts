import { drawBoat } from './boats.js';
import type { Point, Waterways } from './course.js';

const DETAILS = [
  { kind: 'trawler', x: .24, y: .22, heading: -.32, drift: 13, period: 53 },
  { kind: 'whale', x: .57, y: .74, heading: -.5, drift: 15, period: 58 },
  { kind: 'gulls', x: .65, y: .20, heading: .5, drift: 12, period: 36 },
  { kind: 'trawler', x: .79, y: .60, heading: 2.7, drift: 10, period: 67 },
  { kind: 'gulls', x: .30, y: .80, heading: -.6, drift: 13, period: 42 },
] as const;

type SeaDetail = (typeof DETAILS)[number] & { point: Point; scale: number };

export function placeSeaLife(water: Waterways, width: number, height: number): SeaDetail[] {
  const scale = width < 600 ? .78 : 1;
  const placed: SeaDetail[] = [];
  const candidates = DETAILS.map(detail => ({ x: detail.x * width, y: detail.y * height }));
  for (let column = 1; column <= 7; column++) {
    for (let row = 1; row <= 5; row++) candidates.push({ x: width * column / 8, y: height * row / 6 });
  }
  for (const detail of DETAILS) {
    const radius = (detail.drift + (detail.kind === 'whale' ? 21 : 24)) * scale;
    const nearby = [...candidates].sort((a, b) =>
      Math.hypot(a.x - detail.x * width, a.y - detail.y * height) - Math.hypot(b.x - detail.x * width, b.y - detail.y * height));
    const point = nearby.find(point => water.openWater(point, radius)
      && placed.every(other => Math.hypot(point.x - other.point.x, point.y - other.point.y) > 72 * scale));
    if (point) placed.push({ ...detail, point, scale });
  }
  return placed;
}

function whale(ctx: CanvasRenderingContext2D, phase: number): void {
  ctx.fillStyle = '#142e41';
  ctx.strokeStyle = '#50717d';
  ctx.lineWidth = .85;
  ctx.beginPath();
  ctx.moveTo(16, -.7);
  ctx.bezierCurveTo(13, -5.5, 1, -5.9, -6, -2.3);
  ctx.quadraticCurveTo(-12, -.1, -13, -1);
  ctx.quadraticCurveTo(-18, -5.7, -19, -5.2);
  ctx.quadraticCurveTo(-19, -.7, -16, .15);
  ctx.quadraticCurveTo(-19, 1.5, -18, 5.5);
  ctx.quadraticCurveTo(-15, 5.1, -12, 1.5);
  ctx.bezierCurveTo(-5, 3.5, 14, 6.2, 16, -.7);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, 3.3);
  ctx.quadraticCurveTo(1, 8, -4, 7.2);
  ctx.lineTo(-2, 3);
  ctx.fill();
  ctx.stroke();
  const spout = Math.max(0, 1 - Math.abs((phase + 1) % 1 - .19) * 12);
  ctx.strokeStyle = `rgb(194 228 225 / ${spout * .65})`;
  ctx.beginPath();
  ctx.moveTo(10, -.6);
  ctx.quadraticCurveTo(12, -6, 16, -5);
  ctx.moveTo(10, -.6);
  ctx.quadraticCurveTo(9, -6.5, 6, -8);
  ctx.stroke();
}

function gulls(ctx: CanvasRenderingContext2D, time: number): void {
  ctx.strokeStyle = '#d7e5de';
  ctx.lineWidth = 1.15;
  ctx.lineCap = 'round';
  for (const [x, y, scale] of [[0, 0, 1], [-9, -10, .78], [11, 5, .7]]) {
    const wing = (3.2 + Math.sin(time * 3.8 + x) * .9) * scale;
    ctx.beginPath();
    ctx.moveTo(x - 4.3 * scale, y - wing * .45);
    ctx.quadraticCurveTo(x - 2.2 * scale, y - wing, x, y);
    ctx.quadraticCurveTo(x + 2.2 * scale, y - wing, x + 4.3 * scale, y - wing * .45);
    ctx.stroke();
  }
}

export function drawSeaLife(ctx: CanvasRenderingContext2D, details: SeaDetail[], time: number): void {
  const seconds = time / 1000;
  for (const { point, kind, scale, heading, period, drift } of details) {
    const phase = seconds / period;
    const angle = phase * Math.PI * 2;
    ctx.save();
    ctx.translate(point.x + Math.sin(angle) * drift * scale, point.y + Math.sin(angle * 2) * drift * scale * .35);
    ctx.rotate(heading + Math.sin(angle) * .14);
    ctx.scale(scale, scale);
    ctx.globalAlpha = kind === 'whale' ? .86 : .67;
    if (kind === 'whale') whale(ctx, phase);
    if (kind === 'gulls') gulls(ctx, seconds);
    if (kind === 'trawler') {
      ctx.beginPath();
      ctx.moveTo(-7, 1.3);
      ctx.quadraticCurveTo(-15, 2.9, -21, 6);
      ctx.quadraticCurveTo(-25, 8.8, -19, 10.4);
      ctx.strokeStyle = '#a6b2a28a';
      ctx.lineWidth = .9;
      ctx.stroke();
      ctx.fillStyle = '#e3b47c';
      ctx.beginPath();
      ctx.arc(-19, 10.4, 1.45, 0, Math.PI * 2);
      ctx.fill();
      drawBoat(ctx, 0, 0, 0, '#c3be9f', .83, 5);
    }
    ctx.restore();
  }
}
