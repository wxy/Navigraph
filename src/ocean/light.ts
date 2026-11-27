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
    private map: HTMLElement,
    private moon: HTMLCanvasElement,
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
      this.drawMoon();
    }
    this.map.style.setProperty('--daylight', String(daylight));
    this.map.style.setProperty('--night', String(night));
    this.map.style.setProperty('--moonlight', String(night * (1 - Math.cos(this.phase)) / 2));
  }

  private drawMoon(): void {
    const ctx = this.moon.getContext('2d')!;
    ctx.clearRect(0, 0, this.moon.width, this.moon.height);
    const center = DISC_RADIUS;
    const waxing = this.phase < Math.PI;
    const curvature = Math.cos(this.phase);
    const diameter = 2 * DISC_RADIUS;
    ctx.globalAlpha = .16;
    drawSprite(ctx, this.art, 1, center, center, diameter);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, DISC_RADIUS, -HALF_PI, HALF_PI, !waxing);
    // Join the sunlit half of the limb with the curved edge of the shadow.
    if (Math.abs(curvature) < .001) ctx.lineTo(center, 0);
    else ctx.ellipse(center, center, DISC_RADIUS * Math.abs(curvature), DISC_RADIUS, 0, HALF_PI, -HALF_PI, waxing === (curvature > 0));
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 1;
    drawSprite(ctx, this.art, 1, center, center, diameter);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
