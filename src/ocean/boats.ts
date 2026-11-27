import { drawSprite, type OceanArt } from './art.js';

const COLORS = ['#ffdb9b', '#c8ede7', '#e5bd89', '#a4ddc8', '#aed9ed', '#efb6a1', '#ccdca6', '#ffe3ac'];
export const OFFSHORE_TRAWLER = 8;

export const boatDesign = (tabId: number): number => Math.floor(tabId / COLORS.length + tabId) % COLORS.length;
export const boatColor = (tabId: number): string => COLORS[boatDesign(tabId)];

export function drawBoat(
  ctx: CanvasRenderingContext2D, sheet: OceanArt['boats'], x: number, y: number, heading: number, scale: number, design: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  drawSprite(ctx, sheet, design, 0, 0, 27 * scale);
  ctx.restore();
}
