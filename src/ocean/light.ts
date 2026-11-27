import { MoonPhase } from 'astronomy-engine';
import { drawSprite, type OceanArt } from './art.js';

const MINUTE = 60_000;
const MOON_STEP = 15 * MINUTE;
const HALF_PI = Math.PI / 2;
const DISC_RADIUS = 42;

function smoothstep(value: number): number {
  const fraction = Math.max(0, Math.min(1, value));
  return fraction * fraction * (3 - 2 * fraction);
}

export class ChartLight {
  private minute = -Infinity;
  private moonSlot = -Infinity;
  private phase = 0;

  constructor(
    private light: HTMLElement,
    private sky: HTMLCanvasElement,
    private art: OceanArt['celestial'],
  ) {}

  show(timestamp: number): void {
    const minute = Math.floor(timestamp / MINUTE);
    if (minute === this.minute) return;
    this.minute = minute;
    const date = new Date(timestamp);
    const localTime = date.getHours() * 60 + date.getMinutes();
    // Use local clock time for the chart's dawn and dusk.
    const daylight = smoothstep((localTime - 330) / 90) * smoothstep((1110 - localTime) / 90);
    const night = 1 - daylight;
    const moonSlot = Math.floor(timestamp / MOON_STEP);
    if (night > 0 && this.moonSlot !== moonSlot) {
      this.phase = MoonPhase(date) * Math.PI / 180;
      this.moonSlot = moonSlot;
    }
    const curvature = Math.cos(this.phase);
    this.light.style.setProperty('--daylight', String(daylight));
    this.light.style.setProperty('--night', String(night));
    this.light.style.setProperty('--moonlight', String(night * (1 - curvature) * .14));

    const ctx = this.sky.getContext('2d')!;
    ctx.clearRect(0, 0, this.sky.width, this.sky.height);
    const y = this.sky.height / 2;
    const diameter = 2 * DISC_RADIUS;
    if (daylight > 0) {
      ctx.globalAlpha = daylight;
      drawSprite(ctx, this.art, 0, 60, y, diameter);
    }
    if (night > 0) {
      const x = this.sky.width - 59;
      const waxing = this.phase < Math.PI;
      ctx.globalAlpha = night * .16;
      drawSprite(ctx, this.art, 1, x, y, diameter);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, DISC_RADIUS, -HALF_PI, HALF_PI, !waxing);
      // Join the sunlit half of the limb with the curved edge of the shadow.
      if (Math.abs(curvature) < .001) ctx.lineTo(x, y - DISC_RADIUS);
      else ctx.ellipse(x, y, DISC_RADIUS * Math.abs(curvature), DISC_RADIUS, 0, HALF_PI, -HALF_PI, waxing === (curvature > 0));
      ctx.closePath();
      ctx.clip();
      ctx.globalAlpha = night;
      drawSprite(ctx, this.art, 1, x, y, diameter);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
