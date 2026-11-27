import { coursePosition, type Course } from './course.js';
import { easeTravel, TRAIL_FADE } from './replay.js';

const WAKE_LENGTH = 135;
const SAMPLE_SPACING = 4;

export function createWakeBrushes(): HTMLCanvasElement[] {
  return [0, 2.1, 4.2].map(phase => {
    const brush = document.createElement('canvas');
    const width = brush.width = 96;
    const height = brush.height = 40;
    const ctx = brush.getContext('2d')!;
    const pixels = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const across = 2 * y / (height - 1) - 1;
      for (let x = 0; x < width; x++) {
        const along = 2 * x / (width - 1) - 1;
        const center = .13 * Math.sin(along * 7 + phase);
        const edge = Math.max(0, 1 - along ** 2 - ((across - center) / .86) ** 2) ** 1.65;
        const ripple = Math.sin(17 * along + 9 * across + 1.9 * Math.sin(6 * across + phase));
        const swirl = Math.sin(8 * along - 17 * across + 2.3 * Math.cos(5 * along + phase));
        const foam = Math.max(0, ripple * .58 + swirl * .42);
        const index = (y * width + x) * 4;
        pixels.data[index] = 133 + foam * 92;
        pixels.data[index + 1] = 191 + foam * 54;
        pixels.data[index + 2] = 207 + foam * 39;
        pixels.data[index + 3] = (61 + foam * 147) * edge;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return brush;
  });
}

export function drawWake(
  ctx: CanvasRenderingContext2D, brushes: HTMLCanvasElement[], course: Course, start: number, end: number, time: number,
): void {
  const duration = end - start;
  const head = easeTravel(Math.min(1, (time - start) / duration)) * course.length;
  const tail = easeTravel(Math.max(0, (time - start - TRAIL_FADE) / duration)) * course.length;
  const count = Math.max(2, Math.ceil(course.length / SAMPLE_SPACING));
  const spacing = course.length / count;
  const first = Math.max(1, Math.ceil(Math.max(tail, head - WAKE_LENGTH) / spacing));
  for (let index = first; index * spacing < head; index++) {
    const progress = index / count;
    // Invert the sailing ease to recover when the stern disturbed this spot.
    const release = .5 - Math.sin(Math.asin(1 - 2 * progress) / 3);
    const age = Math.max(0, Math.min(1, (time - start - release * duration) / TRAIL_FADE));
    const behind = (head - index * spacing) / WAKE_LENGTH;
    const strength = 4 * release * (1 - release);
    const fade = (1 - age) ** 1.5 * (1 - behind) ** 1.5;
    const rise = Math.min(1, .32 + age * TRAIL_FADE / 125);
    const drift = Math.sin(index * 2.4);
    const length = 17 + 11 * age;
    const width = 13 + 18 * age ** .58 + drift * 2;
    const { x, y, angle } = coursePosition(course, progress);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = .62 * strength * fade * rise;
    ctx.drawImage(brushes[index % brushes.length], -7 - length / 2, -width / 2 + drift * age * 3, length, width);
    ctx.restore();
  }
}
