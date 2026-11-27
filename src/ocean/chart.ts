import { lastArrival, type Arrival, type Dock, type Island, type Route, type Ship } from './history.js';

interface Point { x: number; y: number }
interface Port { center: Point; anchor: Point; size: number }
interface Berth { angle: number; point: Point; ships: Map<Ship, Point> }
interface Curve { start: Point; bend: Point; end: Point }

const ANCHORS = [
  [.37, .43], [.73, .27], [.21, .20], [.72, .72], [.17, .69],
  [.9, .49], [.45, .77], [.52, .20], [.28, .85],
];
const SAILS = ['#ffd498', '#b9edee', '#eeb8a4', '#d1dba6', '#c7c4ee', '#fad1b7'];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function siteHash(site: string): number {
  let hash = 0;
  for (let i = 0; i < site.length; i++) hash = Math.imul(hash, 31) + site.charCodeAt(i) | 0;
  return hash >>> 0;
}

function trace(ctx: CanvasRenderingContext2D, { start, bend, end }: Curve): void {
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(bend.x, bend.y, end.x, end.y);
  ctx.stroke();
}

function coastPoint(port: Port, angle: number): Point {
  return {
    x: port.center.x + Math.cos(angle) * port.size * .50,
    y: port.center.y + Math.sin(angle) * port.size * .47,
  };
}

function dot(ctx: CanvasRenderingContext2D, { x, y }: Point, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function sail(ctx: CanvasRenderingContext2D, point: Point, angle: number, color: string, active: boolean): void {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(angle);
  const scale = active ? 1.65 : 1;
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

export class OceanChart {
  private ports = new Map<Island, Port>();
  private berths = new Map<Dock, Berth>();
  private curves = new Map<Route, Curve>();
  private islandButtons = new Map<Island, HTMLButtonElement>();
  private islands: Island[] = [];
  private routes: Route[] = [];
  private ships: Ship[] = [];
  private selectedShip?: Ship;
  private selectedIsland?: Island;
  private active?: Arrival;
  private underway?: Arrival;
  private fraction = 0;

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

  setHistory(islands: Island[], ships: Ship[], routes: Route[]): void {
    this.islands = islands;
    this.ships = ships;
    this.routes = routes;
    this.selectedShip = undefined;
    this.selectedIsland = undefined;
    this.active = undefined;
    this.underway = undefined;
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
    this.drawShips();
  }

  selectIsland(island?: Island): void {
    if (this.selectedIsland) this.islandButtons.get(this.selectedIsland)?.setAttribute('aria-pressed', 'false');
    this.selectedIsland = island;
    if (island) this.islandButtons.get(island)?.setAttribute('aria-pressed', 'true');
    this.drawShips();
  }

  showPosition(active?: Arrival, underway?: Arrival, fraction = 0): void {
    if (active === this.active && underway === this.underway && (!underway || fraction === this.fraction)) return;
    this.active = active;
    this.underway = underway;
    this.fraction = fraction;
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
    const largest = Math.min(205, width * .22, height * .35, spread ? height : Math.min(cellWidth, cellHeight) * .86);
    const maxRecords = Math.log1p(this.islands[0]?.records ?? 1);
    this.ports.clear();
    this.berths.clear();
    this.islands.forEach((island, index) => {
      const hash = siteHash(island.site);
      const sprite = hash % 9;
      const size = largest * (.36 + .64 * Math.log1p(island.records) / maxRecords);
      const row = Math.floor(index / columns);
      const itemsInRow = Math.min(columns, count - row * columns);
      const x = (index % columns + (columns - itemsInRow + 1) / 2 + ((hash % 19) - 9) / 105) * cellWidth;
      const y = (row + .47 + (((hash >>> 8) % 19) - 9) / 95) * cellHeight;
      const center = spread
        ? { x: ANCHORS[index][0] * width, y: ANCHORS[index][1] * height }
        : { x, y };
      if (count === 1) { center.x = width / 2; center.y = height / 2 - 12; }

      const port = { center, size, anchor: { x: center.x + size * .38, y: center.y + size * .24 } };
      this.ports.set(island, port);
      for (const dock of island.docks) {
        const angle = (.33 + (dock.number - 1) * GOLDEN_ANGLE) % (Math.PI * 2);
        const point = coastPoint(port, angle);
        const ships = new Map<Ship, Point>();
        for (const { ship } of dock.arrivals) {
          if (ships.has(ship)) continue;
          const radius = 5 * Math.sqrt(ships.size);
          const offset = ships.size * GOLDEN_ANGLE;
          ships.set(ship, { x: point.x + Math.cos(offset) * radius, y: point.y + Math.sin(offset) * radius });
        }
        this.berths.set(dock, { angle, point, ships });
      }
      const button = this.islandButtons.get(island)!;
      button.style.left = `${center.x}px`;
      button.style.top = `${center.y}px`;
      button.style.setProperty('--island-size', `${size}px`);
      button.style.setProperty('--label-width', `${Math.max(65, Math.min(164, cellWidth - 8))}px`);
      button.style.setProperty('--sprite-x', `${(sprite % 3) * 50}%`);
      button.style.setProperty('--sprite-y', `${Math.floor(sprite / 3) * 50}%`);
      button.classList.toggle('major', size > 107);
      button.classList.toggle('compact', !spread && cellWidth < 105 && index > 7);
    });
    this.curves.clear();
    for (const route of this.routes) {
      const start = this.ports.get(route.from)!.anchor;
      const end = this.ports.get(route.to)!.anchor;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const arc = Math.min(.26, 76 / Math.hypot(dx, dy));
      this.curves.set(route, {
        start, end, bend: { x: (start.x + end.x) / 2 - dy * arc, y: (start.y + end.y) / 2 + dx * arc },
      });
    }
    this.drawRoutes();
    this.drawShips();
  }

  private drawRoutes(): void {
    const ctx = this.routeLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.map.clientWidth, this.map.clientHeight);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (const { center, size } of this.ports.values()) {
      ctx.strokeStyle = '#85c4c42b';
      for (const radius of [.46, .52, .60]) {
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, size * radius, size * radius * .77, -.26, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const routeSet = this.selectedShip
      ? new Set(this.selectedShip.arrivals.flatMap(({ route }) => route ? [route] : []))
      : this.routes;
    ctx.strokeStyle = this.selectedShip ? '#eacf99b0' : '#a9d8da73';
    ctx.setLineDash([4, 5]);
    for (const route of routeSet) {
      ctx.lineWidth = Math.min(2.5, 1 + .3 * Math.log2(route.crossings));
      trace(ctx, this.curves.get(route)!);
    }
    ctx.setLineDash([]);
  }

  private drawShips(): void {
    const ctx = this.shipLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.map.clientWidth, this.map.clientHeight);
    if (!this.active) return;

    if (this.selectedIsland) {
      ctx.fillStyle = '#9ae1dc9c';
      for (const dock of this.selectedIsland.docks) dot(ctx, this.berths.get(dock)!.point, 2);
    }
    const emphasized = this.underway ?? this.active;
    const route = emphasized.route && this.curves.get(emphasized.route);
    const to = this.berths.get(emphasized.dock)!;
    const from = emphasized.from && this.berths.get(emphasized.from)!;
    const port = this.ports.get(emphasized.island)!;
    // Docks on the same island use the shorter arc along the coast.
    const turn = from ? (to.angle - from.angle + Math.PI * 3) % (2 * Math.PI) - Math.PI : 0;
    if (from) {
      ctx.strokeStyle = '#ffcf89';
      ctx.lineWidth = 1.8;
      ctx.shadowColor = '#ffbf6d77';
      ctx.shadowBlur = 7;
      if (route) {
        trace(ctx, { ...route, start: from.point, end: to.point });
      } else {
        ctx.beginPath();
        ctx.ellipse(port.center.x, port.center.y, port.size * .50, port.size * .47,
          0, from.angle, from.angle + turn, turn < 0);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f9dba9';
      dot(ctx, from.point, 2.6);
      dot(ctx, to.point, 2.6);
    }
    const ships = this.selectedShip ? [this.selectedShip] : this.ships;
    for (const ship of ships) {
      const last = lastArrival(ship, this.active.index);
      const point = last && this.berths.get(last.dock)?.ships.get(ship);
      if (!point || ship === emphasized.ship) continue;
      sail(ctx, point, -.42, SAILS[(ship.number - 1) % SAILS.length], false);
    }

    const destination = to.ships.get(emphasized.ship)!;
    if (!this.underway || !from) {
      sail(ctx, destination, -.42, '#fff2ce', true);
      return;
    }
    const origin = from.ships.get(emphasized.ship)!;
    const t = this.fraction;
    const mt = 1 - t;
    if (!route) {
      const angle = from.angle + t * turn;
      const point = coastPoint(port, angle);
      point.x += mt * (origin.x - from.point.x) + t * (destination.x - to.point.x);
      point.y += mt * (origin.y - from.point.y) + t * (destination.y - to.point.y);
      const bearing = Math.atan2(Math.cos(angle) * turn, -Math.sin(angle) * turn);
      sail(ctx, point, bearing, '#fff2ce', true);
      return;
    }
    const x = mt * mt * origin.x + 2 * mt * t * route.bend.x + t * t * destination.x;
    const y = mt * mt * origin.y + 2 * mt * t * route.bend.y + t * t * destination.y;
    const dx = mt * (route.bend.x - origin.x) + t * (destination.x - route.bend.x);
    const dy = mt * (route.bend.y - origin.y) + t * (destination.y - route.bend.y);
    sail(ctx, { x, y }, Math.atan2(dy, dx), '#fff2ce', true);
  }
}
