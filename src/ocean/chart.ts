import { drawPier, type OceanArt } from './art.js';
import { boatColor, boatDesign, drawBoat } from './boats.js';
import { placeIslands, type Berth } from './coast.js';
import { coursePosition, traceCourse, Waterways, type Course, type Point } from './course.js';
import type { Dock, Island, Ship } from './history.js';
import { TRAIL_FADE, type ShipPosition, type TimedArrival } from './replay.js';
import { drawSeaLife, placeSeaLife } from './sea-life.js';

interface LabelBox extends Point { width: number; height: number }

function eased(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function addClock(
  ctx: CanvasRenderingContext2D, point: Point, text: string, gap: number, occupied: LabelBox[], width: number, height: number,
): void {
  const w = ctx.measureText(text).width + 8;
  const h = 14;
  const candidates = [
    { x: point.x + gap, y: point.y - 13 }, { x: point.x - w - gap, y: point.y - 13 },
    { x: point.x - w / 2, y: point.y - 23 }, { x: point.x - w / 2, y: point.y + 9 },
  ];
  const position = candidates.find(({ x, y }) => x >= 3 && y >= 3 && x + w <= width - 3 && y + h <= height - 3
    && occupied.every(box => x + w < box.x || x > box.x + box.width || y + h < box.y || y > box.y + box.height))
    ?? { x: Math.max(3, Math.min(width - w - 3, candidates[0].x)), y: Math.max(3, Math.min(height - h - 3, candidates[0].y)) };
  occupied.push({ ...position, width: w, height: h });
  ctx.fillStyle = '#071c29df';
  ctx.beginPath();
  ctx.roundRect(position.x, position.y, w, h, 3);
  ctx.fill();
  ctx.fillStyle = '#e5f1ee';
  ctx.fillText(text, position.x + 4, position.y + 10);
}

export class OceanChart {
  private berths = new Map<Dock, Berth>();
  private courses = new Map<string, Course | null>();
  private waterways?: Waterways;
  private seaLife: ReturnType<typeof placeSeaLife> = [];
  private islandButtons = new Map<Island, HTMLButtonElement>();
  private clocks = new Map<Ship, { second: number; label: string }>();
  private islands: Island[] = [];
  private selectedIsland?: Island;
  private fleet: ShipPosition[] = [];
  private trails: TimedArrival[] = [];
  private time = 0;
  private seaTime = 0;
  private width = 0;
  private height = 0;

  constructor(
    private map: HTMLElement,
    private islandLayer: HTMLElement,
    private waterLayer: HTMLCanvasElement,
    private pierLayer: HTMLCanvasElement,
    private shipLayer: HTMLCanvasElement,
    private art: OceanArt,
    private clockFormat: Intl.DateTimeFormat,
    seePort: (island: Island) => void,
  ) {
    this.islandLayer.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.island');
      if (button) seePort(this.islands[Number(button.dataset.index)]);
    });
    new ResizeObserver(() => this.layout()).observe(map);
  }

  setHistory(islands: Island[]): void {
    this.islands = islands;
    this.selectedIsland = undefined;
    this.fleet = [];
    this.trails = [];
    this.time = this.seaTime = 0;
    this.clocks.clear();
    this.islandButtons.clear();
    const fragment = document.createDocumentFragment();
    islands.forEach((island, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'island';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', island.site);
      button.setAttribute('aria-pressed', 'false');
      button.title = island.site;
      const art = document.createElement('span');
      art.className = 'island-art';
      const town = document.createElement('span');
      town.className = 'island-town';
      const name = document.createElement('span');
      name.className = 'island-name';
      name.textContent = island.site;
      button.append(art, town, name);
      this.islandButtons.set(island, button);
      fragment.append(button);
    });
    this.islandLayer.replaceChildren(fragment);
    this.layout();
  }

  selectIsland(island?: Island): void {
    if (this.selectedIsland) this.islandButtons.get(this.selectedIsland)?.setAttribute('aria-pressed', 'false');
    this.selectedIsland = island;
    if (island) this.islandButtons.get(island)?.setAttribute('aria-pressed', 'true');
  }

  showFleet(fleet: ShipPosition[], trails: TimedArrival[], time: number, animate: boolean): void {
    this.fleet = fleet;
    this.trails = trails;
    this.time = time;
    this.seaTime = animate ? time : 0;
    this.drawWater();
    this.drawShips();
  }

  private layout(): void {
    const { clientWidth: width, clientHeight: height } = this.map;
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    const pixels = Math.min(devicePixelRatio, 2);
    for (const canvas of [this.waterLayer, this.pierLayer, this.shipLayer]) {
      canvas.width = Math.round(width * pixels);
      canvas.height = Math.round(height * pixels);
      canvas.getContext('2d')!.setTransform(pixels, 0, 0, pixels, 0, 0);
    }
    const land = placeIslands(this.islands, width, height);
    this.berths = new Map(land.flatMap(({ berths }) => [...berths]));
    const pierContext = this.pierLayer.getContext('2d')!;
    this.courses.clear();
    for (const { island, obstacle, sprite, town, harbor, berths, continent, large, compact, labelWidth } of land) {
      for (const berth of berths.values()) {
        if (berth !== harbor) drawPier(pierContext, this.art.piers, berth, false);
      }
      drawPier(pierContext, this.art.piers, harbor, true);
      const { center, size } = obstacle;
      const button = this.islandButtons.get(island)!;
      const style = button.style;
      style.left = center.x + 'px';
      style.top = center.y + 'px';
      style.setProperty('--island-size', size + 'px');
      style.setProperty('--label-width', labelWidth + 'px');
      style.setProperty('--sprite-x', (sprite % 3) * 50 + '%');
      style.setProperty('--sprite-y', Math.floor(sprite / 3) * 50 + '%');
      style.setProperty('--town-size', town.size + 'px');
      style.setProperty('--town-x', town.point.x - center.x + size / 2 + 'px');
      style.setProperty('--town-y', town.point.y - center.y + size / 2 + 'px');
      style.setProperty('--town-sprite-x', (town.sprite % 2) * 100 + '%');
      style.setProperty('--town-sprite-y', Math.floor(town.sprite / 2) * 100 + '%');
      if (continent) {
        const margin = labelWidth / 2 + 6;
        const labelX = Math.max(margin, Math.min(width - margin, harbor.shore.x));
        const labelY = Math.max(16, harbor.shore.y - town.size * .59);
        style.setProperty('--coast-label-x', labelX - center.x + size / 2 + 'px');
        style.setProperty('--coast-label-y', labelY - center.y + size / 2 + 'px');
      }
      button.classList.toggle('major', large || continent);
      button.classList.toggle('continent', continent);
      button.classList.toggle('compact', compact);
    }
    this.waterways = new Waterways(land.map(({ obstacle }) => obstacle), width, height);
    this.seaLife = placeSeaLife(this.waterways, width, height);
    this.drawWater();
    this.drawShips();
  }

  private courseFor(from: Dock, to: Dock): Course | null {
    const key = from.page + ':' + to.page;
    if (this.courses.has(key)) return this.courses.get(key)!;
    const seed = ((Math.imul(from.page, 31) + to.page) >>> 0) % 997;
    const course = this.waterways!.course(this.berths.get(from)!, this.berths.get(to)!, seed) ?? null;
    if (this.courses.size >= 256) this.courses.delete(this.courses.keys().next().value!);
    this.courses.set(key, course);
    return course;
  }

  private drawWater(): void {
    const ctx = this.waterLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    drawSeaLife(ctx, this.art, this.seaLife, this.seaTime);
    ctx.lineCap = 'round';
    for (const { arrival, start, end } of this.trails) {
      const course = this.courseFor(arrival.previous!.dock, arrival.dock);
      if (!course) continue;
      const duration = end - start;
      const tail = Math.max(0, (this.time - TRAIL_FADE - start) / duration);
      const head = Math.min(1, (this.time - start) / duration);
      if (head <= tail) continue;
      ctx.strokeStyle = boatColor(arrival.ship.tabId);
      ctx.lineWidth = 1.65;
      const bands = Math.max(2, Math.min(7, Math.ceil(course.length * (head - tail) / 18)));
      for (let band = 0; band < bands; band++) {
        const from = tail + (head - tail) * band / bands;
        const to = tail + (head - tail) * (band + 1) / bands;
        const age = this.time - (start + duration * (from + to) / 2);
        ctx.globalAlpha = .87 * (1 - age / TRAIL_FADE) ** 1.45;
        traceCourse(ctx, course, eased(from), eased(to));
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawShips(): void {
    const ctx = this.shipLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    const scale = this.width < 600 ? .82 : 1;
    const ships = this.fleet.map(({ arrival, fraction, timestamp }) => {
      const { ship, dock, previous } = arrival;
      const destination = this.berths.get(dock)!;
      const underway = fraction !== undefined;
      const origin = previous && this.berths.get(previous.dock);
      const course = underway && previous ? this.courseFor(previous.dock, dock) : null;
      const berth = underway && !course && origin ? origin : destination;
      const position = course
        ? coursePosition(course, eased(fraction!))
        : { ...berth.ships.get(ship)!, angle: berth.angle };
      return { position, ship, timestamp, underway };
    });

    for (const { position, ship } of ships) {
      drawBoat(ctx, this.art.boats, position.x, position.y, position.angle, scale, boatDesign(ship.tabId));
    }
    ctx.font = '600 10px system-ui, sans-serif';
    const occupied: LabelBox[] = [];
    for (const { position, ship, timestamp } of ships.sort((a, b) => Number(b.underway) - Number(a.underway))) {
      const second = Math.floor(timestamp / 1000);
      let clock = this.clocks.get(ship);
      if (clock?.second !== second) {
        clock = { second, label: this.clockFormat.format(timestamp) };
        this.clocks.set(ship, clock);
      }
      addClock(ctx, position, clock.label, Math.max(12, 14 * scale), occupied, this.width, this.height);
    }
  }
}
