import type { Berth } from './coast.js';

interface SpriteSheet {
  image: HTMLImageElement;
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

async function loadImage(file: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = '../images/' + file;
  await image.decode();
  return image;
}

async function loadSheet(file: string, columns: number, rows: number): Promise<SpriteSheet> {
  const image = await loadImage(file);
  return { image, columns, cellWidth: image.naturalWidth / columns, cellHeight: image.naturalHeight / rows };
}

export async function loadOceanArt() {
  const [water, piers, boats, marine, birds] = await Promise.all([
    loadImage('ocean-water.webp'),
    loadSheet('ocean-piers.webp', 2, 2),
    loadSheet('ocean-boats.webp', 3, 3),
    loadSheet('ocean-marine.webp', 2, 2),
    loadSheet('ocean-birds.webp', 2, 2),
  ]);
  return { water, piers, boats, marine, birds };
}

export type OceanArt = Awaited<ReturnType<typeof loadOceanArt>>;

export function drawSprite(
  ctx: CanvasRenderingContext2D, sheet: SpriteSheet, index: number, x: number, y: number, width: number,
  height = width * sheet.cellHeight / sheet.cellWidth,
): void {
  const { image, columns, cellWidth, cellHeight } = sheet;
  ctx.drawImage(image,
    index % columns * cellWidth, Math.floor(index / columns) * cellHeight, cellWidth, cellHeight,
    x - width / 2, y - height / 2, width, height);
}
export function drawPier(ctx: CanvasRenderingContext2D, sheet: SpriteSheet, berth: Berth, active: boolean, main: boolean): void {
  const { shore, water, angle } = berth;
  const span = Math.hypot(water.x - shore.x, water.y - shore.y);
  const width = span + 2;
  const height = Math.min(active ? 13 : main ? 11 : 7, width * .62 + 2);
  const design = (main ? 0 : 2) + Number(angle > Math.PI);
  ctx.save();
  ctx.translate(shore.x, shore.y);
  ctx.rotate(angle);
  ctx.globalAlpha = main || active ? 1 : .8;
  drawSprite(ctx, sheet, design, span / 2, 0, width, height);
  ctx.restore();
}
