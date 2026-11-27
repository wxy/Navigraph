import { drawSprite, type OceanArt } from './art.js';

const SHIP_DESIGNS = 8;
export const OFFSHORE_TRAWLER = 8;

export function boatDesign(tabId: number, generation: number): number {
  return (Math.floor(tabId / SHIP_DESIGNS + tabId) + generation * 3) % SHIP_DESIGNS;
}

export function drawBoat(
  ctx: CanvasRenderingContext2D, sheet: OceanArt['boats'], x: number, y: number, heading: number, scale: number, design: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  drawSprite(ctx, sheet, design, 0, 0, 27 * scale);
  ctx.restore();
}
