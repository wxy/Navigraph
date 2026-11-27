import { LAND_GRID } from './land-data.js';

export interface Point { x: number; y: number }

export interface WaterObstacle {
  center: Point;
  radius: number;
  size: number;
  land: readonly number[];
}

export interface Landing {
  shore: Point;
  water: Point;
  gate: Point;
  angle: number;
  island: WaterObstacle;
}

interface Bend { start: Point; control: Point; end: Point }
interface Sample { distance: number; bend: number; t: number }

export interface Course {
  bends: Bend[];
  samples: Sample[];
  length: number;
}

const FULL_TURN = 2 * Math.PI;
const DETOUR_STEPS = 12;
const COMFORTABLE_TURN = 5;

export function polar(center: Point, radius: number, angle: number): Point {
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function touchesIsland(a: Point, b: Point, { center, radius }: WaterObstacle, clearance = 0): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared ? ((center.x - a.x) * dx + (center.y - a.y) * dy) / lengthSquared : 0;
  const t = Math.max(0, Math.min(1, projection));
  return (center.x - a.x - dx * t) ** 2 + (center.y - a.y - dy * t) ** 2 < (radius + clearance) ** 2;
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function touchesTurn(a: Point, corner: Point, b: Point, island: WaterObstacle): boolean {
  const { center } = island;
  if (touchesIsland(a, corner, island) || touchesIsland(corner, b, island) || touchesIsland(b, a, island)) {
    return true;
  }
  if (Math.abs(cross(a, corner, b)) < .001) return false;
  const signs = [cross(a, corner, center), cross(corner, b, center), cross(b, a, center)];
  return signs.every(value => value >= 0) || signs.every(value => value <= 0);
}

function touchesShore(a: Point, control: Point, b: Point, { center, size, land }: WaterObstacle): boolean {
  const cell = size / LAND_GRID;
  const padding = Math.min(1.5, cell * .7);
  const originX = center.x - size / 2;
  const originY = center.y - size / 2;
  function overlaps(start: Point, corner: Point, end: Point): boolean {
    const left = Math.min(start.x, corner.x, end.x);
    const right = Math.max(start.x, corner.x, end.x);
    const top = Math.min(start.y, corner.y, end.y);
    const bottom = Math.max(start.y, corner.y, end.y);
    const fromColumn = Math.max(0, Math.floor((left - padding - originX) / cell));
    const toColumn = Math.min(LAND_GRID - 1, Math.floor((right + padding - originX) / cell));
    const fromRow = Math.max(0, Math.floor((top - padding - originY) / cell));
    const toRow = Math.min(LAND_GRID - 1, Math.floor((bottom + padding - originY) / cell));
    for (let row = fromRow; row <= toRow; row++) {
      for (let column = fromColumn; column <= toColumn; column++) {
        if (!((land[row * 2 + (column >>> 5)] >>> (column & 31)) & 1)) continue;
        // Subdivide the control bounds until they separate from the coast or
        // reach subpixel size. The rendered curve stays inside those bounds.
        if (Math.max(right - left, bottom - top) <= .5) return true;
        const leftControl = mix(start, corner, .5);
        const rightControl = mix(corner, end, .5);
        const middle = mix(leftControl, rightControl, .5);
        return overlaps(start, leftControl, middle) || overlaps(middle, rightControl, end);
      }
    }
    return false;
  }
  return overlaps(a, control, b);
}

export function berthInOpenWater(berth: Point, gate: Point, island: WaterObstacle): Point {
  const blocked = (point: Point) => touchesShore(point, mix(point, gate, .5), gate, island);
  if (!blocked(berth)) return berth;

  // Find the nearest point along the pier with a clear path to open water.
  let inside = berth;
  let outside = gate;
  while (distance(inside, outside) > .5) {
    const halfway = mix(inside, outside, .5);
    if (blocked(halfway)) inside = halfway;
    else outside = halfway;
  }
  return mix(outside, gate, 1 / Math.max(1, distance(outside, gate)));
}

function fitSpline(points: Point[], crossesLand: (bend: Bend) => boolean): Bend[] | undefined {
  while (true) {
    const bends: Bend[] = [];
    const split = new Set<number>();
    for (let i = 1; i < points.length - 1; i++) {
      const first = i === 1;
      const last = i === points.length - 2;
      const control = points[i];
      const start = first ? points[0] : mix(points[i - 1], control, .5);
      const end = last ? points[i + 1] : mix(control, points[i + 1], .5);
      const bend = { start, control, end };
      bends.push(bend);
      if (!crossesLand(bend)) continue;
      const left = distance(points[i - 1], control) > .5;
      const right = distance(control, points[i + 1]) > .5;
      if (!left && !right) return;
      if (left) split.add(i - 1);
      if (right) split.add(i);
    }
    if (!split.size) return bends;
    // Refine only the affected guides. Midpoint joins keep adjacent tangents aligned.
    points = points.flatMap((point, index) => split.has(index)
      ? [point, mix(point, points[index + 1], .5)]
      : [point]);
  }
}

function tightestTurn(bends: Bend[]): number {
  let radius = Infinity;
  for (const { start, control, end } of bends) {
    const ax = control.x - start.x;
    const ay = control.y - start.y;
    const bx = end.x - control.x;
    const by = end.y - control.y;
    if (ax * bx + ay * by >= 0) continue;
    const area = Math.abs(ax * by - ay * bx);
    if (!area) return 0;
    const dx = bx - ax;
    const dy = by - ay;
    const t = -(ax * dx + ay * dy) / (dx * dx + dy * dy);
    radius = Math.min(radius, 2 * Math.hypot(ax + dx * t, ay + dy * t) ** 3 / area);
  }
  return radius;
}

function sampleCourse(bends: Bend[]): Course | undefined {
  let last = bends[0].start;
  const samples: Sample[] = [{ distance: 0, bend: 0, t: 0 }];
  let length = 0;
  bends.forEach(({ start, control, end }, bend) => {
    const steps = Math.max(4, Math.ceil((distance(start, control) + distance(control, end)) / 4));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const point = mix(mix(start, control, t), mix(control, end, t), t);
      const traveled = distance(last, point);
      if (traveled > .0001) {
        length += traveled;
        samples.push({ distance: length, bend, t });
      }
      last = point;
    }
  });
  return samples.length > 1 ? { bends, samples, length } : undefined;
}

function locate({ samples, length }: Course, fraction: number): Pick<Sample, 'bend' | 't'> {
  const traveled = length * Math.max(0, Math.min(1, fraction));
  let low = 1;
  let high = samples.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].distance < traveled) low = mid + 1;
    else high = mid;
  }
  const next = samples[low];
  const previous = samples[low - 1];
  const progress = (traveled - previous.distance) / (next.distance - previous.distance);
  const before = previous.bend === next.bend ? previous.t : 0;
  return { bend: next.bend, t: before + (next.t - before) * progress };
}

export function coursePosition(course: Course, fraction: number): Point & { angle: number } {
  const { bend, t } = locate(course, fraction);
  const { start, control, end } = course.bends[bend];
  const a = mix(start, control, t);
  const b = mix(control, end, t);
  return { ...mix(a, b, t), angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export class Waterways {
  private detours?: Point[];

  constructor(private islands: readonly WaterObstacle[], private width: number, private height: number) {}

  openWater(point: Point, radius: number): boolean {
    return point.x >= radius && point.y >= radius && point.x <= this.width - radius && point.y <= this.height - radius
      && this.islands.every(island => !touchesIsland(point, point, island, radius));
  }

  course(from: Landing, to: Landing, seed: number): Course | undefined {
    const crossesLand = ({ start, control, end }: Bend) => this.islands.some(island => {
      if (!touchesTurn(start, control, end, island)) return false;
      if (island !== from.island && island !== to.island) return true;
      return touchesShore(start, control, end, island);
    });
    const coastal = from.island === to.island;
    const turn = this.coastalTurn(from, to);
    if (!coastal) {
      const direct = this.singleBend(from, to);
      if (direct && !crossesLand(direct)) return sampleCourse([direct]);
    } else if (Math.abs(turn) < .38) {
      // Nearby piers can share a shallow arc. Taking both boats out past the
      // island's clearance circle first creates a hairpin at each end.
      const start = from.water;
      const end = to.water;
      const span = distance(start, end);
      for (const lift of [.28, .40, .48]) {
        const control = polar(mix(start, end, .5), span * lift, from.angle + turn / 2);
        const bend = { start, control, end };
        if (this.inside(control) && !crossesLand(bend)) {
          const course = sampleCourse([bend]);
          if (course) return course;
        }
      }
    }
    from = this.widerTurn(from);
    to = this.widerTurn(to);
    let best = this.fittedCourse(from, to, coastal, seed, crossesLand);
    let radius = best ? tightestTurn(best) : -1;
    if (best && radius >= COMFORTABLE_TURN) return sampleCourse(best);

    // Where a straight radial departure would force a tight turn, try sailing
    // out diagonally through clear water before joining the same offshore route.
    const departures = this.approaches(from, to.gate);
    const arrivals = this.approaches(to, from.gate);
    for (const departure of departures) {
      for (const arrival of arrivals) {
        if (departure === from && arrival === to) continue;
        const alternative = this.fittedCourse(departure, arrival, coastal, seed, crossesLand);
        if (!alternative) continue;
        const clearance = tightestTurn(alternative);
        if (clearance >= COMFORTABLE_TURN) return sampleCourse(alternative);
        if (clearance > radius) {
          best = alternative;
          radius = clearance;
        }
      }
    }
    return best ? sampleCourse(best) : undefined;
  }

  private fittedCourse(
    from: Landing, to: Landing, coastal: boolean, seed: number, crossesLand: (bend: Bend) => boolean,
  ): Bend[] | undefined {
    if (!this.clear(from.water, from.gate, from.island) || !this.clear(to.gate, to.water, to.island)) return;
    const guides = coastal ? this.alongCoast(from, this.coastalTurn(from, to), seed) : [this.seaGuide(from, to, seed)];
    const preferred = [...guides, to.gate];
    const clear = preferred.every((point, index) => this.inside(point)
      && this.clear(index ? preferred[index - 1] : from.gate, point));
    const middle = clear ? preferred : this.connect(from.gate, to.gate);
    if (!middle) return;
    const guidesWithBerths = [from.water, from.gate, ...middle, to.water];
    const points = guidesWithBerths.filter((point, index) => !index || distance(guidesWithBerths[index - 1], point) > .001);
    return fitSpline(points, crossesLand);
  }

  private coastalTurn(from: Landing, to: Landing): number {
    return (to.angle - from.angle + FULL_TURN * 1.5) % FULL_TURN - Math.PI;
  }

  private approaches(landing: Landing, other: Point): Landing[] {
    const { island, water } = landing;
    const radius = distance(island.center, landing.gate);
    const options = [landing];
    for (const offset of [-.88, -.55, -.30, .30, .55, .88]) {
      const angle = landing.angle + offset;
      const gate = polar(island.center, radius, angle);
      if (this.inside(gate) && this.clear(water, gate, island) && !touchesShore(water, mix(water, gate, .5), gate, island)) {
        options.push({ ...landing, angle, gate });
      }
    }
    return options.sort((a, b) => distance(a.gate, other) - distance(b.gate, other)).slice(0, 4);
  }

  private widerTurn(landing: Landing): Landing {
    const { center, radius } = landing.island;
    const outer = distance(center, landing.gate) + Math.min(16, radius * .25);
    const gate = polar(center, outer, landing.angle);
    return this.inside(gate) && this.clear(landing.gate, gate, landing.island) ? { ...landing, gate } : landing;
  }

  private singleBend(from: Landing, to: Landing): Bend | undefined {
    const start = from.water;
    const end = to.water;
    const departure = polar({ x: 0, y: 0 }, 1, from.angle);
    const arrival = polar({ x: 0, y: 0 }, 1, to.angle);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const divisor = departure.x * arrival.y - departure.y * arrival.x;
    if (Math.abs(divisor) < .01) return;
    const outward = (dx * arrival.y - dy * arrival.x) / divisor;
    const inward = (dx * departure.y - dy * departure.x) / divisor;
    const span = Math.hypot(dx, dy);
    if (outward <= 0 || inward <= 0 || Math.max(outward, inward) > span) return;
    const control = polar(start, outward, from.angle);
    if (this.inside(control)) return { start, control, end };
  }

  private inside(p: Point): boolean {
    return p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height;
  }

  private clear(a: Point, b: Point, coast?: WaterObstacle): boolean {
    return this.islands.every(island => island === coast || !touchesIsland(a, b, island, Math.min(2, island.radius * .08)));
  }

  private alongCoast(from: Landing, turn: number, seed: number): Point[] {
    const island = from.island;
    const radius = distance(island.center, from.gate);
    const reach = Math.min(20, island.radius * .25) * (.86 + (seed % 11) * .028);
    const count = Math.max(2, Math.ceil(Math.abs(turn) / .53));
    const points: Point[] = [];
    for (let n = 1; n < count; n++) {
      const t = n / count;
      points.push(polar(island.center, radius + Math.sin(Math.PI * t) * reach, from.angle + turn * t));
    }
    return points;
  }

  private seaGuide(from: Landing, to: Landing, seed: number): Point {
    const { gate: a } = from;
    const { gate: b } = to;
    const span = distance(a, b);
    const sweep = Math.min(55, span * .16) * (.9 + (seed % 7) * .04);
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    return polar(mix(a, b, .5), sweep, heading + Math.PI / 2);
  }

  private connect(from: Point, to: Point): Point[] | undefined {
    if (this.clear(from, to)) return [to];
    this.detours ??= this.islands.flatMap(island => {
      // A circumscribed polygon lets straight links between turns clear the island.
      const radius = (island.radius + 4) / Math.cos(Math.PI / DETOUR_STEPS);
      return Array.from({ length: DETOUR_STEPS }, (_, index) =>
        polar(island.center, radius, index * FULL_TURN / DETOUR_STEPS),
      ).filter(point => this.inside(point) && this.clear(point, point));
    });
    const vertices = [from, to, ...this.detours];
    const costs = new Float64Array(vertices.length).fill(Infinity);
    const parents = new Int32Array(vertices.length).fill(-1);
    const closed = new Uint8Array(vertices.length);
    const queue = new Set([0]);
    costs[0] = 0;
    while (queue.size) {
      let current = -1;
      let best = Infinity;
      for (const index of queue) {
        const estimate = costs[index] + distance(vertices[index], to);
        if (estimate < best) {
          best = estimate;
          current = index;
        }
      }
      if (current === 1) {
        const path = [];
        for (let index = 1; index !== 0; index = parents[index]) path.push(vertices[index]);
        return path.reverse();
      }
      queue.delete(current);
      closed[current] = 1;
      const origin = vertices[current];
      for (let index = 1; index < vertices.length; index++) {
        if (closed[index]) continue;
        const target = vertices[index];
        const cost = costs[current] + distance(origin, target);
        if (cost < costs[index] && this.clear(origin, target)) {
          costs[index] = cost;
          parents[index] = current;
          queue.add(index);
        }
      }
    }
    return undefined;
  }
}
