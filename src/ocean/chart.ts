import { coursePosition, polar, Waterways, type Course, type Landing, type Point, type WaterObstacle } from './course.js';
import type { Arrival, Dock, Island, Route, Ship } from './history.js';
import type { ShipPosition } from './replay.js';
import { SHORE_RADII } from './shore-data.js';

interface Berth extends Landing {
  size: number;
  ships: Map<Ship, Point>;
}

const ANCHORS = [
  [.37, .43], [.73, .27], [.21, .20], [.72, .72], [.17, .69],
  [.88, .49], [.45, .77], [.52, .20], [.28, .81],
];
const SAILS = ['#ffd498', '#b9edee', '#eeb8a4', '#d1dba6', '#c7c4ee', '#fad1b7'];
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FULL_TURN = 2 * Math.PI;
const COASTS = SHORE_RADII.map(samples => samples.flatMap((radius, index) =>
  radius > 0 ? [{ angle: index * FULL_TURN / samples.length, radius: radius / 1000 }] : [],
));

function siteHash(site: string): number {
  let hash = 0;
  for (let i = 0; i < site.length; i++) hash = (Math.imul(hash, 31) + site.charCodeAt(i)) | 0;
  return hash >>> 0;
}

function mooring(dock: Dock, island: WaterObstacle, sprite: number, size: number): Berth {
  const coast = COASTS[sprite];
  const position = ((dock.number - 1) * GOLDEN_RATIO % 1) * coast.length;
  const index = Math.floor(position);
  const start = coast[index];
  const end = coast[(index + 1) % coast.length];
  const gap = (end.angle - start.angle + FULL_TURN) % FULL_TURN;
  // Interpolate only between adjacent samples on the same stretch of coast.
  const fraction = gap < .055 && Math.abs(end.radius - start.radius) < .023 ? position - index : 0;
  const angle = (start.angle + gap * fraction) % FULL_TURN;
  const coastRadius = (start.radius + (end.radius - start.radius) * fraction) * size;
  const shore = polar(island.center, coastRadius - 1.5, angle);
  const water = polar(island.center, coastRadius + Math.min(12, size * .22), angle);
  const gate = polar(island.center, island.radius + Math.min(12, size * .16), angle);
  const ships = new Map<Ship, Point>();
  for (const { ship } of dock.arrivals) {
    if (ships.has(ship)) continue;
    const radius = Math.min(10, 4 * Math.sqrt(ships.size));
    const offset = ships.size * GOLDEN_ANGLE;
    ships.set(ship, polar(water, radius, angle + Math.sin(offset) * Math.PI / 2));
  }
  return { angle, shore, water, gate, island, size, ships };
}

function pier(ctx: CanvasRenderingContext2D, berth: Berth, lit: boolean): void {
  ctx.beginPath();
  ctx.moveTo(berth.shore.x, berth.shore.y);
  ctx.lineTo(berth.water.x, berth.water.y);
  ctx.lineCap = 'square';
  ctx.strokeStyle = '#171f22';
  ctx.lineWidth = lit ? 4.2 : 2.8;
  ctx.stroke();
  ctx.strokeStyle = lit ? '#eabf87' : '#b99371';
  ctx.lineWidth = lit ? 2.5 : 1.35;
  ctx.stroke();
  if (lit) {
    ctx.beginPath();
    ctx.arc(berth.water.x, berth.water.y, 2.4, 0, FULL_TURN);
    ctx.fillStyle = '#fff0bd';
    ctx.fill();
  }
}

function sail(ctx: CanvasRenderingContext2D, point: Point, angle: number, color: string, scale: number): void {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = '#102b38';
  ctx.fillStyle = '#ac714b';
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.quadraticCurveTo(1, 4.5, -6, 2.3);
  ctx.lineTo(-6, -2.3);
  ctx.quadraticCurveTo(1, -4.5, 8, 0);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-4.5, .8);
  ctx.lineTo(2.4, .7);
  ctx.quadraticCurveTo(1, -1.7, -.7, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function wake(ctx: CanvasRenderingContext2D, course: Course, fraction: number): void {
  const length = Math.min(.12, 22 / course.length, fraction);
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const point = coursePosition(course, fraction - length * (1 - i / 6));
    if (i) ctx.lineTo(point.x, point.y);
    else ctx.moveTo(point.x, point.y);
  }
  ctx.strokeStyle = '#d6f8f7bd';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

export class OceanChart {
  private berths = new Map<Dock, Berth>();
  private courses = new Map<string, Course | null>();
  private waterways?: Waterways;
  private islandButtons = new Map<Island, HTMLButtonElement>();
  private islands: Island[] = [];
  private routes: Route[] = [];
  private selectedShip?: Ship;
  private selectedIsland?: Island;
  private fleet: ShipPosition[] = [];
  private primary?: Arrival;

  constructor(
    private map: HTMLElement,
    private islandLayer: HTMLElement,
    private routeLayer: HTMLCanvasElement,
    private shipLayer: HTMLCanvasElement,
    seePort: (island: Island) => void,
  ) {
    this.islandLayer.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.island');
      if (button) seePort(this.islands[Number(button.dataset.index)]);
    });
    new ResizeObserver(() => this.layout()).observe(map);
  }

  setHistory(islands: Island[], routes: Route[]): void {
    this.islands = islands;
    this.routes = routes;
    this.selectedShip = undefined;
    this.selectedIsland = undefined;
    this.fleet = [];
    this.primary = undefined;
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
      const name = document.createElement('span');
      name.className = 'island-name';
      name.textContent = island.site;
      button.append(art, name);
      this.islandButtons.set(island, button);
      fragment.append(button);
    });
    this.islandLayer.replaceChildren(fragment);
    this.layout();
  }

  focus(ship?: Ship): void {
    this.selectedShip = ship;
    const visited = ship && new Set(ship.arrivals.map(arrival => arrival.island));
    for (const [island, button] of this.islandButtons) {
      button.classList.toggle('subdued', Boolean(visited && !visited.has(island)));
    }
    this.drawRoutes();
  }

  selectIsland(island?: Island): void {
    if (this.selectedIsland) this.islandButtons.get(this.selectedIsland)?.setAttribute('aria-pressed', 'false');
    this.selectedIsland = island;
    if (island) this.islandButtons.get(island)?.setAttribute('aria-pressed', 'true');
    this.drawShips();
  }

  showFleet(fleet: ShipPosition[], primary?: Arrival): void {
    this.fleet = fleet;
    this.primary = primary;
    this.drawShips();
  }

  private layout(): void {
    const { clientWidth: width, clientHeight: height } = this.map;
    const pixels = Math.min(devicePixelRatio, 2);
    for (const canvas of [this.routeLayer, this.shipLayer]) {
      canvas.width = Math.round(width * pixels);
      canvas.height = Math.round(height * pixels);
      canvas.getContext('2d')!.setTransform(pixels, 0, 0, pixels, 0, 0);
    }
    const count = this.islands.length;
    const spread = width > 780 && count <= ANCHORS.length;
    const columns = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * width / height))));
    const rows = Math.max(1, Math.ceil(count / columns));
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const largest = Math.min(205, width * .22, height * .35, spread ? height : Math.min(cellWidth, cellHeight) * .66);
    const maxRecords = Math.log1p(this.islands[0]?.records ?? 1);
    const obstacles: WaterObstacle[] = [];
    this.berths.clear();
    this.courses.clear();
    this.islands.forEach((island, index) => {
      const hash = siteHash(island.site);
      const sprite = hash % COASTS.length;
      const size = largest * (.36 + .64 * Math.log1p(island.records) / maxRecords);
      const row = Math.floor(index / columns);
      const itemsInRow = Math.min(columns, count - row * columns);
      const x = (index % columns + (columns - itemsInRow + 1) / 2 + ((hash % 19) - 9) / 105) * cellWidth;
      const y = (row + .47 + (((hash >>> 8) % 19) - 9) / 95) * cellHeight;
      const center = spread
        ? { x: ANCHORS[index][0] * width, y: ANCHORS[index][1] * height }
        : { x, y };
      if (count === 1) { center.x = width / 2; center.y = height / 2 - 12; }

      // Each sprite is clipped to this circle. The margin gives sails room to pass.
      const obstacle = { center, radius: size * .50 + Math.min(9, size * .12) };
      obstacles.push(obstacle);
      for (const dock of island.docks) this.berths.set(dock, mooring(dock, obstacle, sprite, size));
      const button = this.islandButtons.get(island)!;
      button.style.left = center.x + 'px';
      button.style.top = center.y + 'px';
      button.style.setProperty('--island-size', size + 'px');
      button.style.setProperty('--label-width', Math.max(65, Math.min(164, cellWidth - 8)) + 'px');
      button.style.setProperty('--sprite-x', (sprite % 3) * 50 + '%');
      button.style.setProperty('--sprite-y', Math.floor(sprite / 3) * 50 + '%');
      button.classList.toggle('major', size > 107);
      button.classList.toggle('compact', !spread && cellWidth < 105 && index > 7);
    });
    this.waterways = new Waterways(obstacles, width, height);
    this.drawRoutes();
    this.drawShips();
  }

  private courseFor(from: Dock, to: Dock): Course | null {
    const key = from.page + ':' + to.page;
    if (this.courses.has(key)) return this.courses.get(key)!;
    const seed = ((Math.imul(from.page, 31) + to.page) >>> 0) % 997;
    const course = this.waterways!.course(this.berths.get(from)!, this.berths.get(to)!, seed) ?? null;
    // Keep the courses used by the current playback without accumulating an entire day's shapes.
    if (this.courses.size >= 256) this.courses.delete(this.courses.keys().next().value!);
    this.courses.set(key, course);
    return course;
  }

  private drawRoutes(): void {
    const ctx = this.routeLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.map.clientWidth, this.map.clientHeight);
    const routes = this.selectedShip
      ? new Set(this.selectedShip.arrivals.flatMap(({ route }) => route ? [route] : []))
      : this.routes;
    ctx.strokeStyle = this.selectedShip ? '#eacf99a6' : '#a9d8da65';
    ctx.lineCap = 'round';
    ctx.setLineDash([2, 6]);
    for (const route of routes) {
      const course = this.courseFor(route.from, route.to);
      if (!course) continue;
      ctx.lineWidth = Math.min(2.5, 1 + .3 * Math.log2(route.crossings));
      ctx.stroke(course.path);
    }
    ctx.setLineDash([]);
  }

  private drawShips(): void {
    const ctx = this.shipLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.map.clientWidth, this.map.clientHeight);
    const moving = this.fleet.some(position => position.fraction !== undefined);
    const lit = new Set<Berth>();
    const quiet = new Set<Berth>();

    if (this.selectedIsland) {
      ctx.globalAlpha = this.selectedIsland.docks.length > 30 ? .4 : .75;
      for (const dock of this.selectedIsland.docks) pier(ctx, this.berths.get(dock)!, false);
      ctx.globalAlpha = 1;
    }
    const ships = this.fleet.map(({ arrival, fraction }) => {
      const { ship, from, dock } = arrival;
      const destination = this.berths.get(dock)!;
      const traveling = fraction !== undefined;
      const emphasized = traveling || (!moving && arrival === this.primary);
      const origin = from && this.berths.get(from)!;
      const course = emphasized && from ? this.courseFor(from, dock) : null;
      const color = SAILS[(ship.number - 1) % SAILS.length];
      if (course) {
        ctx.strokeStyle = this.selectedShip || !moving ? '#ffcf89' : color + 'bb';
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.75;
        ctx.shadowColor = color + '59';
        ctx.shadowBlur = 6;
        ctx.stroke(course.path);
        ctx.shadowBlur = 0;
        lit.add(origin!);
      }
      (emphasized ? lit : quiet).add(destination);
      return { traveling, fraction, destination, origin, course, ship, color, emphasized };
    });
    for (const berth of quiet) {
      if (!lit.has(berth)) pier(ctx, berth, false);
    }
    for (const berth of lit) pier(ctx, berth, true);

    for (const entry of ships) {
      const { traveling, origin, destination, fraction, course, ship, color, emphasized } = entry;
      const scale = Math.min(1.35, Math.max(.35, destination.size / 102)) * (emphasized ? 1.08 : .82);
      if (traveling && course) {
        const t = fraction! * fraction! * (3 - 2 * fraction!);
        const point = coursePosition(course, t);
        wake(ctx, course, t);
        sail(ctx, point, point.angle, color, scale);
        continue;
      }
      const berth = traveling && origin ? origin : destination;
      sail(ctx, berth.ships.get(ship)!, berth.angle, color, scale);
    }
  }
}
