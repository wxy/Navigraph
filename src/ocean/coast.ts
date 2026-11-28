import { berthInOpenWater, polar, type Landing, type Point, type WaterObstacle } from './course.js';
import { siteHash, type Dock, type Island, type Ship } from './history.js';
import { LAND_GRID, LAND_TILES } from './land-data.js';
import { LARGE_LAND_TILES, LARGE_SHORE_RADII } from './large-island-data.js';
import { SHORE_RADII } from './shore-data.js';

export interface Berth extends Landing {
  slips: Map<Ship, Point>;
}

const WIDE_ANCHORS = [[.35, .43], [.73, .28], [.16, .22], [.67, .77], [.29, .78], [.87, .56]];
const TALL_ANCHORS = [[.35, .27], [.69, .48], [.70, .15], [.26, .65], [.62, .82], [.23, .46]];
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;
const FULL_TURN = 2 * Math.PI;
const coastalSamples = (atlas: readonly (readonly number[])[]) => atlas.map(samples => samples.flatMap((radius, index) =>
  radius > 0 ? [{ angle: index * FULL_TURN / samples.length, radius: radius / 1000 }] : [],
));
const COASTS = coastalSamples(SHORE_RADII);
const LARGE_COASTS = coastalSamples(LARGE_SHORE_RADII);

function mooring(dock: Dock, island: WaterObstacle, coast: typeof COASTS[number]): Berth {
  const { size } = island;
  const position = ((dock.number - 1) * GOLDEN_RATIO % 1) * coast.length;
  const index = Math.floor(position);
  const start = coast[index];
  const end = coast[(index + 1) % coast.length];
  const gap = (end.angle - start.angle + FULL_TURN) % FULL_TURN;
  // Avoid interpolating across bays that lack a continuous section of shoreline.
  const fraction = gap < .055 && Math.abs(end.radius - start.radius) < .023 ? position - index : 0;
  const angle = (start.angle + gap * fraction) % FULL_TURN;
  const radius = (start.radius + (end.radius - start.radius) * fraction) * size;
  const shore = polar(island.center, radius - 1.5, angle);
  const gate = polar(island.center, island.radius + Math.min(12, size * .16), angle);
  const water = berthInOpenWater(polar(island.center, radius + Math.min(15, size * .23), angle), gate, island);
  const slips = new Map<Ship, Point>();
  for (const ship of dock.ships) {
    const index = slips.size;
    const offset = index * Math.PI * (3 - Math.sqrt(5));
    const radius = Math.min(17, 10 * Math.sqrt(index));
    const point = polar(water, radius, angle + Math.sin(offset) * Math.PI / 2);
    slips.set(ship, index ? berthInOpenWater(point, gate, island) : water);
  }
  return { angle, shore, water, gate, island, slips };
}

function onLand({ center, size, land }: WaterObstacle, point: Point): boolean {
  const column = Math.floor((point.x - center.x + size / 2) * LAND_GRID / size);
  const row = Math.floor((point.y - center.y + size / 2) * LAND_GRID / size);
  return column >= 0 && column < LAND_GRID && row >= 0 && row < LAND_GRID
    && Boolean((land[row * 2 + (column >>> 5)] >>> (column & 31)) & 1);
}

function townBehind(berth: Berth, continent: boolean, sprite: number, width: number) {
  const { island, shore, angle } = berth;
  const size = continent ? Math.min(78, island.size * .16) : Math.min(51, island.size * .45);
  const inward = angle + Math.PI;
  let best = { point: polar(shore, size * .44, inward), coverage: -1 };
  for (const depth of [.38, .54, .71, .9]) {
    for (const turn of [0, -.34, .34]) {
      const point = polar(shore, size * depth, inward + turn);
      if (continent && (point.x < size * .4 || point.x > width - size * .4)) continue;
      if (!onLand(island, point)) continue;
      let coverage = 1;
      for (let n = 0; n < 8; n++) {
        if (onLand(island, polar(point, size * .28, n * FULL_TURN / 8))) coverage++;
      }
      if (coverage > best.coverage) best = { point, coverage };
    }
  }
  return { point: best.point, size: best.coverage < 6 ? size * .75 : size, sprite: continent ? 3 : sprite % 4 };
}

function islandSize(island: Island, room: number, maxRecords: number): number {
  const weight = Math.log1p(island.records) / maxRecords;
  return room * (island.scale === 'small' ? .36 + .37 * weight : .8 + .20 * weight);
}

function islandRadius(size: number): number {
  return size * .50 + Math.min(9, size * .12);
}

function scatteredPoints(islands: readonly Island[], width: number, height: number, room: number, maxRecords: number): Point[] {
  const points: (Point & { radius: number })[] = [];
  const waterGap = Math.min(23, room * .16);
  for (const island of islands) {
    const radius = islandRadius(islandSize(island, room, maxRecords));
    const margin = radius + 12;
    let seed = Math.imul(siteHash(island.site), 1597334677) >>> 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let attempt = 0; attempt < 70; attempt++) {
      const point = {
        x: margin + random() * (width - 2 * margin),
        y: margin + random() * (height - 2 * margin),
      };
      if (points.some(other => Math.hypot(point.x - other.x, point.y - other.y) < radius + other.radius + waterGap)) continue;
      points.push({ ...point, radius });
      break;
    }
  }
  return points;
}

function islandPositions(islands: readonly Island[], left: number, width: number, height: number, maxRecords: number) {
  const count = islands.length;
  const tall = width < height * 1.16;
  if (count <= WIDE_ANCHORS.length) {
    const anchors = tall ? TALL_ANCHORS : WIDE_ANCHORS;
    return islands.map((_, index) => {
      const [x, y] = count === 1 ? [.47, .51] : anchors[index];
      return { center: { x: left + x * width, y: y * height }, room: Math.min(width * .29, height * .36, 239),
        labelWidth: Math.min(164, width * .35), compact: false };
    });
  }

  // Stagger two uneven island groups around a wide, gently curved passage.
  const length = tall ? height : width;
  const passage = Math.min(124, length * .15);
  const divide = (length - passage) * .43;
  const firstGroup = Math.round(count * .43);
  const groups = [islands.slice(0, firstGroup), islands.slice(firstGroup)];
  return groups.flatMap((group, groupNumber) => {
    const first = groupNumber === 0;
    const groupCount = group.length;
    const extent = first ? divide : length - divide - passage;
    const offset = first ? 0 : divide + passage;
    const groupWidth = tall ? width : extent;
    const groupHeight = tall ? extent : height;
    const columns = Math.min(groupCount, Math.ceil(Math.sqrt(groupCount * groupWidth / groupHeight)));
    const rows = Math.ceil(groupCount / columns);
    const cellWidth = groupWidth / columns;
    const cellHeight = groupHeight / rows;
    const room = Math.min(239, Math.min(cellWidth, cellHeight) * .64);
    const scattered = groupCount <= 32 ? scatteredPoints(group, groupWidth, groupHeight, room, maxRecords) : [];
    return group.map((island, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const rowCount = Math.min(columns, groupCount - row * columns);
      const hash = siteHash(island.site);
      const stagger = ((column * 7 + (first ? 2 : 10)) % 13 - 6) / 25;
      const point = scattered.length === groupCount ? scattered[index] : {
        x: (column + (columns - rowCount + 1) / 2 + ((hash % 23) - 11) / 61) * cellWidth,
        y: (row + .50 + stagger + (((hash >>> 8) % 19) - 9) / 128) * cellHeight,
      };
      const { x, y } = point;
      const bend = Math.sin((tall ? x / width : y / height) * Math.PI * 1.6 - .81) * passage * .26;
      const center = tall ? { x: left + x, y: y + offset + bend } : { x: left + x + offset + bend, y };
      // Keep the outside islands clear of the viewport edges after the passage bends.
      const margin = islandRadius(islandSize(island, room, maxRecords)) + 8;
      center.x = Math.max(left + margin, Math.min(left + width - margin, center.x));
      center.y = Math.max(margin, Math.min(height - margin, center.y));
      const rank = first ? index : index + firstGroup;
      return { center, room, labelWidth: Math.max(65, Math.min(164, cellWidth - 8)), compact: cellWidth < 105 && rank > 7 };
    });
  });
}

export function placeIslands(islands: readonly Island[], width: number, height: number) {
  const continents = islands.filter(island => island.scale === 'continent').slice(0, width >= 1050 ? 2 : 1);
  const continentCount = continents.length;
  const continentSize = Math.min(590, height * .91, width * .70);
  const padding = continentSize * .39 + 32;
  const shoreLeft = continentCount > 0 ? padding : 0;
  const openWidth = width - shoreLeft - (continentCount > 1 ? padding : 0);
  const offshore = islands.filter(island => !continents.includes(island));
  const maxRecords = Math.log1p(islands[0]?.records ?? 1);
  const positions = islandPositions(offshore, shoreLeft, openWidth, height, maxRecords);

  return [...continents, ...offshore].map((island, index) => {
    const continent = index < continentCount;
    const hash = siteHash(island.site);
    const large = island.scale !== 'small';
    const sprite = continent ? index + 2 : hash % (large ? 2 : COASTS.length);
    const position = positions[index - continentCount];
    const size = continent ? continentSize : islandSize(island, position.room, maxRecords);
    const center = continent
      ? { x: index === 0 ? -size * .13 : width + size * .13, y: height * (index === 0 ? .46 : .56) }
      : position.center;
    const obstacle = { center, size, radius: islandRadius(size), land: (large ? LARGE_LAND_TILES : LAND_TILES)[sprite] };
    const shoreline = (large ? LARGE_COASTS : COASTS)[sprite];
    const coast = continent ? shoreline.filter(({ angle, radius }) => {
      const shore = polar(center, radius * size, angle);
      const gate = polar(center, obstacle.radius + 12, angle);
      const intoMap = Math.cos(angle) * (index === 0 ? 1 : -1);
      return intoMap > .46 && shore.x > 12 && shore.x < width - 12 && gate.y > 18 && gate.y < height - 18;
    }) : shoreline;
    const berths = new Map(island.docks.map(dock => [dock, mooring(dock, obstacle, coast)]));
    const facingDocks = continent ? island.docks.filter(dock => {
      const x = berths.get(dock)!.shore.x;
      const margin = Math.min(78, size * .16) * .83;
      return x >= margin && x <= width - margin;
    }) : island.docks;
    const port = (facingDocks.length ? facingDocks : island.docks)
      .reduce((best, dock) => dock.arrivals.length > best.arrivals.length ? dock : best);
    const harbor = berths.get(port)!;
    const town = townBehind(harbor, continent, sprite, width);
    return { island, obstacle, sprite, berths, harbor, town, continent, large,
      compact: position?.compact ?? false, labelWidth: position?.labelWidth ?? 135 };
  });
}
