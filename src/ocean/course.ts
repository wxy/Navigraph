export interface Point { x: number; y: number }

export interface WaterObstacle {
  center: Point;
  radius: number;
}

export interface Landing {
  shore: Point;
  water: Point;
  gate: Point;
  angle: number;
  island: WaterObstacle;
}

interface Sample extends Point { distance: number }

export interface Course {
  path: Path2D;
  samples: Sample[];
  length: number;
}

const FULL_TURN = 2 * Math.PI;
const DETOUR_STEPS = 12;

export function polar(center: Point, radius: number, angle: number): Point {
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

function mix(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function touchesIsland(a: Point, b: Point, { center, radius }: WaterObstacle): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared ? ((center.x - a.x) * dx + (center.y - a.y) * dy) / lengthSquared : 0;
  const t = Math.max(0, Math.min(1, projection));
  return (center.x - a.x - dx * t) ** 2 + (center.y - a.y - dy * t) ** 2 < radius * radius;
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

function smoothCourse(points: Point[], islands: readonly WaterObstacle[]): Course {
  const path = new Path2D();
  const first = points[0];
  path.moveTo(first.x, first.y);
  const samples: Sample[] = [{ ...first, distance: 0 }];
  let last = first;
  let length = 0;
  const sample = (point: Point) => {
    length += distance(samples[samples.length - 1], point);
    samples.push({ ...point, distance: length });
  };
  const lineTo = (point: Point) => {
    if (distance(last, point) < .01) return;
    path.lineTo(point.x, point.y);
    sample(point);
    last = point;
  };

  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1];
    const corner = points[i];
    const after = points[i + 1];
    let round = Math.min(distance(before, corner) * .46, distance(corner, after) * .46, 60);
    while (round > .35) {
      const entry = mix(corner, before, round / distance(corner, before));
      const exit = mix(corner, after, round / distance(corner, after));
      // A Bézier never leaves the convex hull of its control points.
      // Only round this corner if the whole control triangle is in the water.
      if (!islands.some(island => touchesTurn(entry, corner, exit, island))) {
        lineTo(entry);
        const c1 = mix(entry, corner, .71);
        const c2 = mix(exit, corner, .68);
        path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, exit.x, exit.y);
        const steps = Math.max(5, Math.ceil(round / 2.5));
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          const p = mix(mix(entry, c1, t), mix(c1, c2, t), t);
          const q = mix(mix(c1, c2, t), mix(c2, exit, t), t);
          sample(mix(p, q, t));
        }
        last = exit;
        break;
      }
      round /= 2;
    }
    if (round <= .35) lineTo(corner);
  }
  lineTo(points[points.length - 1]);
  return { path, samples, length };
}

export function coursePosition({ samples, length }: Course, fraction: number): Point & { angle: number } {
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
  const t = (traveled - previous.distance) / (next.distance - previous.distance);
  return { ...mix(previous, next, t), angle: Math.atan2(next.y - previous.y, next.x - previous.x) };
}

export class Waterways {
  private detours?: Point[];

  constructor(private islands: readonly WaterObstacle[], private width: number, private height: number) {}

  course(from: Landing, to: Landing, seed: number): Course | undefined {
    if (!this.clear(from.water, from.gate, from.island) || !this.clear(to.gate, to.water, to.island)) return;
    const waypoints = from.island === to.island ? this.alongCoast(from, to, seed) : this.acrossSea(from, to, seed);
    const water = [from.gate];
    for (const next of waypoints) {
      if (!this.inside(next) || !this.clear(next, next)) continue;
      const leg = this.connect(water[water.length - 1], next);
      if (leg) water.push(...leg);
    }
    const finish = this.connect(water[water.length - 1], to.gate);
    if (!finish) return;
    const result = smoothCourse([from.water, ...water, ...finish, to.water], this.islands);
    return result.samples.length > 1 ? result : undefined;
  }

  private inside(p: Point): boolean {
    return p.x >= 0 && p.y >= 0 && p.x <= this.width && p.y <= this.height;
  }

  private clear(a: Point, b: Point, coast?: WaterObstacle): boolean {
    return this.islands.every(island => island === coast || !touchesIsland(a, b, island));
  }

  private alongCoast(from: Landing, to: Landing, seed: number): Point[] {
    const island = from.island;
    const turn = (to.angle - from.angle + FULL_TURN * 1.5) % FULL_TURN - Math.PI;
    const count = Math.max(3, Math.ceil(Math.abs(turn) / .47));
    const reach = Math.min(20, island.radius * .25);
    const points: Point[] = [];
    for (let n = 1; n < count; n++) {
      const t = n / count;
      const bend = Math.sin(Math.PI * t) * Math.sin(seed + t * 5) * .17;
      const drift = (1.25 + Math.sin(seed + t * 7) * .55) * reach;
      points.push(polar(island.center, island.radius + drift, from.angle + turn * t + bend));
    }
    return points;
  }

  private acrossSea(from: Landing, to: Landing, seed: number): Point[] {
    const { gate: a } = from;
    const { gate: b } = to;
    const span = distance(a, b);
    const sweep = Math.min(53, span * .18) * (.88 + (seed % 7) * .05);
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    return [
      polar(mix(a, b, .18), sweep * .65, heading + Math.PI / 2),
      polar(mix(a, b, .37), sweep, heading + Math.PI / 2),
      polar(mix(a, b, .58), sweep * .15, heading - Math.PI / 2),
      polar(mix(a, b, .79), sweep * .8, heading - Math.PI / 2),
    ];
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
