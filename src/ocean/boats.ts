import { drawSprite, type OceanArt } from './art.js';

const SHIP_DESIGNS = 8;
export const OFFSHORE_TRAWLER = 8;

interface SailShape {
  hinge: number;
  side: number;
  outlines: number[][][];
}

// The outlines isolate sails from the original 144 × 98 bitmap cells.
const SAILS: Partial<Record<number, SailShape>> = {
  0: { hinge: 60, side: 1, outlines: [[[29, 51], [47, 32], [53, 10], [63, 9], [65, 20], [112, 60], [107, 66], [62, 74], [60, 80], [54, 80], [55, 50]]] },
  1: { hinge: 61, side: 1, outlines: [
    [[33, 59], [58, 14], [63, 9], [67, 18], [100, 57], [101, 62], [66, 65], [64, 77], [60, 77], [59, 61]],
    [[97, 62], [99, 40], [102, 32], [105, 35], [129, 61], [107, 67], [101, 73]],
  ] },
  2: { hinge: 60, side: 1, outlines: [
    [[13, 57], [45, 28], [49, 20], [54, 20], [54, 69], [48, 72], [47, 59]],
    [[55, 58], [86, 35], [92, 25], [96, 26], [98, 63], [95, 70], [89, 61]],
  ] },
  3: { hinge: 46, side: -1, outlines: [[[54, 6], [61, 4], [68, 16], [109, 60], [63, 72], [26, 74], [43, 57], [54, 43]]] },
  6: { hinge: 63, side: 1, outlines: [[[35, 2], [42, 4], [82, 33], [96, 50], [93, 63], [78, 74], [43, 83], [45, 72], [54, 45], [48, 24]]] },
};

interface SailingArt {
  hull: HTMLCanvasElement;
  sail: HTMLCanvasElement;
}

const sailingArt = new WeakMap<OceanArt['boats'], Map<number, SailingArt>>();

function splitSailboat(sheet: OceanArt['boats'], design: number, shape: SailShape): SailingArt {
  const width = sheet.cellWidth;
  const height = sheet.cellHeight;
  const canvases = Array.from({ length: 3 }, () => {
    const bitmap = document.createElement('canvas');
    bitmap.width = width;
    bitmap.height = height;
    return bitmap;
  });
  const [original, hull, sail] = canvases;
  drawSprite(original.getContext('2d')!, sheet, design, width / 2, height / 2, width, height);
  const outline = new Path2D();
  for (const polygon of shape.outlines) {
    const [[x, y], ...rest] = polygon;
    outline.moveTo(x, y);
    for (const [x, y] of rest) outline.lineTo(x, y);
    outline.closePath();
  }
  const sailContext = sail.getContext('2d')!;
  sailContext.clip(outline);
  sailContext.drawImage(original, 0, 0);
  const hullContext = hull.getContext('2d')!;
  hullContext.drawImage(original, 0, 0);
  hullContext.clip(outline);
  hullContext.clearRect(0, 0, width, height);
  // Restore the deck beneath the sail from the opposite side of the painted hull.
  hullContext.translate(0, 2 * shape.hinge);
  hullContext.scale(1, -1);
  hullContext.drawImage(original, 0, 0);
  return { hull, sail };
}

export function boatDesign(tabId: number, generation: number): number {
  return (Math.floor(tabId / SHIP_DESIGNS + tabId) + generation * 3) % SHIP_DESIGNS;
}

export function drawBoat(
  ctx: CanvasRenderingContext2D, sheet: OceanArt['boats'], x: number, y: number, heading: number, scale: number, design: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  const width = 27 * scale;
  const shape = SAILS[design];
  if (shape) {
    const height = width * sheet.cellHeight / sheet.cellWidth;
    let designs = sailingArt.get(sheet);
    if (!designs) sailingArt.set(sheet, designs = new Map());
    let layers = designs.get(design);
    if (!layers) designs.set(design, layers = splitSailboat(sheet, design, shape));
    ctx.drawImage(layers.hull, -width / 2, -height / 2, width, height);
    const view = Math.max(-1, Math.min(1, Math.cos(heading) / .46));
    const turn = shape.side * Math.sin(view * Math.PI / 2);
    if (Math.abs(turn) > .015) {
      const hinge = (shape.hinge / sheet.cellHeight - .5) * height;
      ctx.translate(0, hinge);
      ctx.scale(1, turn);
      ctx.drawImage(layers.sail, -width / 2, -height / 2 - hinge, width, height);
    }
  } else drawSprite(ctx, sheet, design, 0, 0, width);
  ctx.restore();
}
