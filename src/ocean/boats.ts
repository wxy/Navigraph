const COLORS = ['#ffdb9b', '#b9eded', '#f3bbab', '#d4dfaa', '#d5c8f5', '#ffdfbe'];
const HULLS = [
  { length: 8.5, beam: 2.6 },
  { length: 9.2, beam: 2.4 },
  { length: 10.5, beam: 2.5 },
  { length: 8.8, beam: 1.5 },
  { length: 8.6, beam: 3.4 },
  { length: 10, beam: 3.2 },
];

export const boatColor = (tabId: number): string => COLORS[tabId % COLORS.length];

function hull(ctx: CanvasRenderingContext2D, length: number, beam: number): void {
  ctx.beginPath();
  ctx.moveTo(length, 0);
  ctx.quadraticCurveTo(length * .45, beam * 1.35, -length * .53, beam);
  ctx.quadraticCurveTo(-length * .89, beam * .78, -length * .84, 0);
  ctx.quadraticCurveTo(-length * .89, -beam * .78, -length * .53, -beam);
  ctx.quadraticCurveTo(length * .45, -beam * 1.35, length, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function sail(ctx: CanvasRenderingContext2D, mast: number, width: number, height: number): void {
  ctx.beginPath();
  ctx.moveTo(mast - width, .5);
  ctx.lineTo(mast + width * .47, .5);
  ctx.quadraticCurveTo(mast + width * .18, -height * .23, mast - width * .16, -height);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function drawBoat(
  ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, color: string, scale: number, design: number,
): void {
  const { length, beam } = HULLS[design];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#132b33';
  ctx.fillStyle = design >= 4 ? '#86523a' : '#aa7953';
  if (design === 3) {
    ctx.save();
    ctx.translate(0, -2.55);
    hull(ctx, length, beam);
    ctx.translate(0, 5.1);
    hull(ctx, length, beam);
    ctx.restore();
    ctx.fillStyle = '#ceb28b';
    ctx.fillRect(-4, -2.6, 7.5, 5.2);
  } else {
    hull(ctx, length, beam);
  }
  ctx.fillStyle = color;
  if (design === 0) sail(ctx, .3, 4.8, 6.8);
  if (design === 1) {
    sail(ctx, -1.2, 4.8, 7.1);
    sail(ctx, 4.1, 2.4, 4.6);
  }
  if (design === 2) {
    sail(ctx, -3.6, 3.2, 5.5);
    sail(ctx, 2, 4, 7.7);
  }
  if (design === 3) sail(ctx, .7, 4.4, 8.3);
  if (design === 4) {
    ctx.beginPath();
    ctx.roundRect(-3.2, -2.9, 7.4, 5.8, 1.35);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#698f97';
    ctx.fillRect(1.5, -2.1, 1.4, 4.2);
  }
  if (design === 5) {
    ctx.fillRect(-1.5, -2.45, 4.7, 4.9);
    ctx.strokeRect(-1.5, -2.45, 4.7, 4.9);
    ctx.fillStyle = '#dead72';
    ctx.fillRect(-5.8, -1.7, 2.9, 3.4);
    ctx.fillStyle = '#334f54';
    ctx.fillRect(1.25, -1.65, 1.05, 3.3);
  }
  ctx.restore();
}

export const boatDesign = (tabId: number): number => Math.floor(tabId / COLORS.length + tabId) % HULLS.length;
