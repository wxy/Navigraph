import { drawSprite, type OceanArt } from './art.js';
import type { WaterObstacle } from './course.js';

const TILE = 128;
const MARGIN = 34;
const SIZE = TILE + 2 * MARGIN;

function makeShallows(sheet: OceanArt['islands'], sprite: number, reach: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  drawSprite(ctx, sheet, sprite, SIZE / 2, SIZE / 2, TILE, TILE);
  const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
  const distance = new Float32Array(SIZE ** 2);
  for (let index = 0; index < distance.length; index++) distance[index] = pixels.data[index * 4 + 3] >= 160 ? 0 : SIZE;

  // Two diagonal passes approximate distance to the actual painted coastline.
  for (const step of [1, -1]) {
    const start = step === 1 ? 1 : SIZE - 2;
    const end = step === 1 ? SIZE - 1 : 0;
    for (let y = start; y !== end; y += step) {
      for (let x = start; x !== end; x += step) {
        const index = y * SIZE + x;
        const row = index - step * SIZE;
        distance[index] = Math.min(distance[index], distance[index - step] + 1, distance[row] + 1,
          distance[row - 1] + Math.SQRT2, distance[row + 1] + Math.SQRT2);
      }
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const index = y * SIZE + x;
      const current = .96 + .12 * Math.sin(x * .18 + y * .12) + .11 * Math.sin(x * .085 - y * .14);
      const depth = Math.min(1, distance[index] / (reach * current));
      const color = 1 - depth ** .64;
      const rgba = index * 4;
      pixels.data[rgba] = 39 + 62 * color;
      pixels.data[rgba + 1] = 119 + 53 * color;
      pixels.data[rgba + 2] = 133 + 21 * color;
      pixels.data[rgba + 3] = 219 * (1 - depth) ** 1.65;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export class ShallowWater {
  private images = new Map<string, HTMLCanvasElement>();

  constructor(private art: OceanArt) {}

  draw(ctx: CanvasRenderingContext2D, { center, size }: WaterObstacle, sprite: number, large: boolean, continent: boolean): void {
    const key = `${large}:${continent}:${sprite}`;
    let image = this.images.get(key);
    if (!image) {
      image = makeShallows(large ? this.art.largeIslands : this.art.islands, sprite, continent ? 15 : 26);
      this.images.set(key, image);
    }
    const width = size * SIZE / TILE;
    ctx.save();
    ctx.globalAlpha *= large ? .91 : .72;
    ctx.drawImage(image, center.x - width / 2, center.y - width / 2, width, width);
    ctx.restore();
  }
}
