import { _ } from '../lib/utils/i18n.js';
import { drawPier, type OceanArt } from './art.js';
import { boatDesign, drawBoat } from './boats.js';
import { placeIslands, type Berth } from './coast.js';
import { coursePosition, Waterways, type Course, type Point } from './course.js';
import type { Arrival, Dock, Island, Ship } from './history.js';
import { easeTravel, type ShipPosition, type TimedArrival } from './replay.js';
import { drawSeaLife, placeSeaLife } from './sea-life.js';
import { ShallowWater } from './shallows.js';
import { createWakeBrushes, drawWake } from './wake.js';

interface LabelBox extends Point { width: number; height: number }
type Pose = Point & { angle: number };
const CAST_OFF_DISTANCE = 10;

function shortestTurn(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function addClock(
  ctx: CanvasRenderingContext2D, point: Point, text: string, gap: number, occupied: LabelBox[], width: number, height: number,
): LabelBox {
  const w = ctx.measureText(text).width + 8;
  const h = 14;
  const candidates = [
    { x: point.x + gap, y: point.y - 13 }, { x: point.x - w - gap, y: point.y - 13 },
    { x: point.x - w / 2, y: point.y - 23 }, { x: point.x - w / 2, y: point.y + 9 },
  ];
  const position = candidates.find(({ x, y }) => x >= 3 && y >= 3 && x + w <= width - 3 && y + h <= height - 3
    && occupied.every(box => x + w < box.x || x > box.x + box.width || y + h < box.y || y > box.y + box.height))
    ?? { x: Math.max(3, Math.min(width - w - 3, candidates[0].x)), y: Math.max(3, Math.min(height - h - 3, candidates[0].y)) };
  const box = { ...position, width: w, height: h };
  occupied.push(box);
  ctx.fillStyle = '#071c29df';
  ctx.beginPath();
  ctx.roundRect(position.x, position.y, w, h, 3);
  ctx.fill();
  ctx.fillStyle = '#e5f1ee';
  ctx.fillText(text, position.x + 4, position.y + 10);
  return box;
}

export class OceanChart {
  private berths = new Map<Dock, Berth>();
  private courses = new Map<string, Course | null>();
  private waterways?: Waterways;
  private seaLife: ReturnType<typeof placeSeaLife> = [];
  private seaSeed = Math.floor(Math.random() * 2 ** 32);
  private wakeBrushes?: HTMLCanvasElement[];
  private shallows: ShallowWater;
  private islandButtons = new Map<Island, HTMLButtonElement>();
  private shipTargets = new Map<Ship, { button: HTMLButtonElement; clockTarget: HTMLElement; arrival: Arrival }>();
  private clocks = new Map<Ship, { second: number; label: string }>();
  private islands: Island[] = [];
  private land: ReturnType<typeof placeIslands> = [];
  private visibleIslands?: Map<Island, number>;
  private selectedIsland?: Island;
  private selectedShip?: Ship;
  private fleet: ShipPosition[] = [];
  private trails: TimedArrival[] = [];
  private time = 0;
  private seaTime = 0;
  private width = 0;
  private height = 0;

  constructor(
    private map: HTMLElement,
    private islandLayer: HTMLElement,
    private shallowLayer: HTMLCanvasElement,
    private waterLayer: HTMLCanvasElement,
    private pierLayer: HTMLCanvasElement,
    private shipLayer: HTMLCanvasElement,
    private shipTargetLayer: HTMLElement,
    private art: OceanArt,
    private clockFormat: Intl.DateTimeFormat,
    seePort: (island: Island) => void,
    private seeVisit: (arrival: Arrival) => void,
  ) {
    this.shallows = new ShallowWater(art);
    this.islandLayer.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.island');
      if (button) seePort(this.islands[Number(button.dataset.index)]);
    });
    new ResizeObserver(() => this.layout()).observe(map);
  }

  setHistory(islands: Island[]): void {
    this.islands = islands;
    this.selectedIsland = undefined;
    this.selectedShip = undefined;
    this.visibleIslands = undefined;
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
    if (this.visibleIslands) {
      this.drawCoasts();
      this.drawShips();
    }
  }

  focusIsland(island: Island): void {
    this.islandButtons.get(island)?.focus();
  }

  selectShip(ship?: Ship): void {
    if (this.selectedShip === ship) return;
    if (this.selectedShip) this.shipTargets.get(this.selectedShip)?.button.removeAttribute('aria-current');
    this.selectedShip = ship;
    if (ship) this.shipTargets.get(ship)?.button.setAttribute('aria-current', 'true');
  }

  shipButton(ship?: Ship): HTMLButtonElement | undefined {
    return ship && this.shipTargets.get(ship)?.button;
  }

  showFleet(fleet: ShipPosition[], trails: TimedArrival[], time: number, animate: boolean, visibleIslands?: Map<Island, number>): void {
    this.fleet = fleet;
    this.trails = trails;
    this.time = time;
    this.seaTime = animate ? time : 0;
    this.showIslands(visibleIslands);
    this.drawWater();
    this.drawShips();
  }

  private layout(): void {
    const { clientWidth: width, clientHeight: height } = this.map;
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    const pixels = Math.min(devicePixelRatio, 2);
    for (const canvas of [this.shallowLayer, this.waterLayer, this.pierLayer, this.shipLayer]) {
      canvas.width = Math.round(width * pixels);
      canvas.height = Math.round(height * pixels);
      canvas.getContext('2d')!.setTransform(pixels, 0, 0, pixels, 0, 0);
    }
    this.land = placeIslands(this.islands, width, height);
    this.berths = new Map(this.land.flatMap(({ berths }) => [...berths]));
    this.courses.clear();
    for (const { island, obstacle, sprite, town, harbor, continent, large, compact, labelWidth } of this.land) {
      const { center, size } = obstacle;
      const button = this.islandButtons.get(island)!;
      const style = button.style;
      style.left = center.x + 'px';
      style.top = center.y + 'px';
      style.setProperty('--island-size', size + 'px');
      style.setProperty('--label-width', labelWidth + 'px');
      const columns = large ? 2 : 3;
      const strip = 100 / (columns - 1);
      style.setProperty('--sprite-x', (sprite % columns) * strip + '%');
      style.setProperty('--sprite-y', Math.floor(sprite / columns) * strip + '%');
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
    this.waterways = new Waterways(this.land.map(({ obstacle }) => obstacle), width, height);
    this.seaLife = placeSeaLife(this.waterways, width, height, this.seaSeed);
    this.drawCoasts();
    this.drawWater();
    this.drawShips();
  }

  private islandOpacity(island: Island): number {
    if (!this.visibleIslands || island.scale !== 'small' || island === this.selectedIsland) return 1;
    return this.visibleIslands.get(island) ?? 0;
  }

  private showIslands(visible?: Map<Island, number>): void {
    const previous = this.visibleIslands;
    if (previous === visible || (previous && visible && previous.size === visible.size
      && [...visible].every(([island, opacity]) => opacity === previous.get(island)))) return;
    this.visibleIslands = visible;
    this.drawCoasts();
  }

  private drawCoasts(): void {
    const pierContext = this.pierLayer.getContext('2d')!;
    const shallowContext = this.shallowLayer.getContext('2d')!;
    pierContext.clearRect(0, 0, this.width, this.height);
    shallowContext.clearRect(0, 0, this.width, this.height);
    for (const { island, obstacle, sprite, harbor, berths, continent, large } of this.land) {
      const opacity = this.islandOpacity(island);
      const button = this.islandButtons.get(island)!;
      const hidden = opacity === 0;
      if (button.hidden !== hidden) button.hidden = hidden;
      if (hidden) continue;
      if (button.style.opacity !== String(opacity)) button.style.opacity = String(opacity);
      pierContext.globalAlpha = shallowContext.globalAlpha = opacity;
      this.shallows.draw(shallowContext, obstacle, sprite, large, continent);
      for (const berth of berths.values()) {
        if (berth !== harbor) drawPier(pierContext, this.art.piers, berth, false);
      }
      drawPier(pierContext, this.art.piers, harbor, true);
    }
    pierContext.globalAlpha = shallowContext.globalAlpha = 1;
  }

  private courseFor({ dock, ship, previous }: Arrival): Course | null {
    const from = previous!.dock;
    const key = from.id + ':' + dock.id + ':' + ship.number;
    if (this.courses.has(key)) return this.courses.get(key)!;
    const seed = ((Math.imul(from.id, 31) + dock.id) >>> 0) % 997;
    const origin = this.berths.get(from)!;
    const destination = this.berths.get(dock)!;
    const course = this.waterways!.course(
      { ...origin, water: origin.slips.get(ship)! },
      { ...destination, water: destination.slips.get(ship)! },
      seed,
    ) ?? null;
    if (this.courses.size >= 256) this.courses.delete(this.courses.keys().next().value!);
    this.courses.set(key, course);
    return course;
  }

  private drawWater(): void {
    const ctx = this.waterLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    drawSeaLife(ctx, this.art, this.seaLife, this.seaTime);
    for (const { arrival, start, end } of this.trails) {
      const course = this.courseFor(arrival);
      if (course) drawWake(ctx, this.wakeBrushes ??= createWakeBrushes(), course, start, end, this.time);
    }
  }

  private mooredPose(arrival: Arrival): Pose {
    const berth = this.berths.get(arrival.dock)!;
    const approach = arrival.previous ? arrival : arrival.mooredVia;
    const course = approach && this.courseFor(approach);
    const angle = course ? coursePosition(course, 1).angle : berth.angle;
    return { ...berth.slips.get(arrival.ship)!, angle };
  }

  private launchPose({ ship, previous }: Arrival): Pose {
    const departure = previous!;
    if (departure.ship === ship) return this.mooredPose(departure);
    const berth = this.berths.get(departure.dock)!;
    return { ...berth.slips.get(ship)!, angle: berth.angle };
  }

  private shipPose({ arrival, fraction }: ShipPosition): Pose {
    if (fraction === undefined) return this.mooredPose(arrival);
    const course = this.courseFor(arrival);
    if (!course) return this.launchPose(arrival);
    const progress = easeTravel(fraction);
    const position = coursePosition(course, progress);
    const traveled = progress * course.length;
    const turnDistance = Math.min(CAST_OFF_DISTANCE, course.length * .4);
    if (traveled < turnDistance) {
      const { angle } = this.launchPose(arrival);
      // Keep the turn direction consistent when departing opposite the moored heading.
      const forward = coursePosition(course, 0).angle;
      const turn = shortestTurn(forward - angle) + shortestTurn(position.angle - forward);
      position.angle = angle + turn * easeTravel(traveled / turnDistance);
    }
    return position;
  }

  private drawShips(): void {
    const ctx = this.shipLayer.getContext('2d')!;
    ctx.clearRect(0, 0, this.width, this.height);
    const scale = this.width < 600 ? .82 : 1;
    const ships = this.fleet.flatMap(position => {
      const { arrival, timestamp, parked, fraction } = position;
      const underway = fraction !== undefined;
      const opacity = underway ? 1 : this.islandOpacity(arrival.island);
      return opacity ? [{ position: this.shipPose(position), arrival, timestamp, underway, parked, opacity }] : [];
    });
    const priority = ({ underway, parked }: typeof ships[number]) => underway ? 2 : parked ? 0 : 1;
    for (const { position, arrival, parked, opacity } of ships) {
      const { ship } = arrival;
      ctx.globalAlpha = opacity * (parked ? .83 : 1);
      drawBoat(ctx, this.art.boats, position.x, position.y, position.angle, scale, boatDesign(ship.tabId, ship.generation));
    }
    ctx.font = '600 10px system-ui, sans-serif';
    const occupied: LabelBox[] = [];
    const visible = new Set<Ship>();
    for (const vessel of ships.sort((a, b) => priority(b) - priority(a))) {
      const { position, arrival, timestamp, parked, underway, opacity } = vessel;
      const { ship } = arrival;
      const second = Math.floor(timestamp / 1000);
      let clock = this.clocks.get(ship);
      if (clock?.second !== second) {
        clock = { second, label: this.clockFormat.format(timestamp) };
        this.clocks.set(ship, clock);
      }
      ctx.globalAlpha = opacity * (underway ? 1 : parked ? .61 : .76);
      const clockBox = addClock(ctx, position, clock.label, Math.max(12, 14 * scale), occupied, this.width, this.height);
      this.positionShipTarget(arrival, position, clockBox, priority(vessel));
      visible.add(ship);
    }
    ctx.globalAlpha = 1;
    for (const [ship, { button }] of this.shipTargets) {
      if (visible.has(ship)) continue;
      button.remove();
      this.shipTargets.delete(ship);
    }
  }

  private positionShipTarget(arrival: Arrival, position: Point, clockBox: LabelBox, priority: number): void {
    const { ship, island } = arrival;
    let target = this.shipTargets.get(ship);
    const changed = target?.arrival !== arrival;
    if (!target) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ocean-ship-target';
      if (this.selectedShip === ship) button.setAttribute('aria-current', 'true');
      const clockTarget = document.createElement('span');
      clockTarget.className = 'ocean-ship-clock';
      clockTarget.style.height = `${clockBox.height}px`;
      button.append(clockTarget);
      const entry = { button, clockTarget, arrival };
      button.addEventListener('click', () => this.seeVisit(entry.arrival));
      this.shipTargetLayer.append(button);
      this.shipTargets.set(ship, entry);
      target = entry;
    }
    const { button, clockTarget } = target;
    if (changed) {
      target.arrival = arrival;
      button.setAttribute('aria-label', `${_('ocean_visit_details', '访问详情')} · ${_('ocean_ship', '船 {0}', ship.number)} · ${island.site}`);
    }
    const x = Math.round(position.x);
    const y = Math.round(position.y);
    const transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    if (button.style.transform !== transform) button.style.transform = transform;
    const clockTransform = `translate(${Math.floor(clockBox.x) - x}px, ${Math.floor(clockBox.y) - y}px)`;
    if (clockTarget.style.transform !== clockTransform) clockTarget.style.transform = clockTransform;
    const clockWidth = `${Math.ceil(clockBox.width)}px`;
    if (clockTarget.style.width !== clockWidth) clockTarget.style.width = clockWidth;
    const layer = String(priority);
    if (button.style.zIndex !== layer) button.style.zIndex = layer;
  }
}
