import { berthInOpenWater, polar, type Landing, type Point, type WaterObstacle } from './course.js';
import type { Dock, Island, Ship } from './history.js';
import { LAND_GRID, LAND_TILES } from './land-data.js';
import { SHORE_RADII } from './shore-data.js';

export interface Berth extends Landing {
  ships: Map<Ship, Point>;
}

const ANCHORS = [
  [.37, .43], [.73, .27], [.21, .20], [.72, .72], [.17, .69],
  [.88, .49], [.45, .77], [.52, .20], [.28, .81],
];
const GOLDEN_RATIO = (Math.sqrt(5) - 1) / 2;
const FULL_TURN = 2 * Math.PI;
const COASTS = SHORE_RADII.map(samples => samples.flatMap((radius, index) =>
  radius > 0 ? [{ angle: index * FULL_TURN / samples.length, radius: radius / 1000 }] : [],
));

function siteHash(site: string): number {
  let hash = 0;
  for (let i = 0; i < site.length; i++) hash = (Math.imul(hash, 31) + site.charCodeAt(i)) | 0;
  return hash >>> 0;
}

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
  const ships = new Map<Ship, Point>();
  for (const { ship } of dock.arrivals) {
    if (ships.has(ship)) continue;
    const offset = ships.size * Math.PI * (3 - Math.sqrt(5));
    const radius = Math.min(17, 10 * Math.sqrt(ships.size));
    ships.set(ship, polar(water, radius, angle + Math.sin(offset) * Math.PI / 2));
  }
  return { angle, shore, water, gate, island, ships };
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

export function placeIslands(islands: readonly Island[], width: number, height: number) {
  const continents = islands.filter(island => island.scale === 'continent').slice(0, width >= 1050 ? 2 : 1);
  const continentCount = continents.length;
  const continentSize = Math.min(590, height * .91, width * .70);
  const padding = continentSize * .39 + 32;
  const shoreLeft = continentCount > 0 ? padding : 0;
  const openWidth = width - shoreLeft - (continentCount > 1 ? padding : 0);
  const count = islands.length - continentCount;
  const spread = openWidth > 740 && count <= ANCHORS.length;
  const columns = Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count * openWidth / height))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const cellWidth = openWidth / columns;
  const cellHeight = height / rows;
  const islandLimit = Math.min(239, openWidth * .23, height * .37, spread ? height : Math.min(cellWidth, cellHeight) * .66);
  const maxRecords = Math.log1p(islands[0]?.records ?? 1);

  return [...continents, ...islands.filter(island => !continents.includes(island))].map((island, index) => {
    const continent = index < continentCount;
    const hash = siteHash(island.site);
    const sprite = continent ? index === 0 ? 5 : 7 : hash % COASTS.length;
    const large = island.scale !== 'small';
    const weight = Math.log1p(island.records) / maxRecords;
    const size = continent ? continentSize : islandLimit * (large ? .8 + .20 * weight : .36 + .37 * weight);
    const position = index - continentCount;
    const row = Math.floor(position / columns);
    const itemsInRow = Math.min(columns, count - row * columns);
    const cellX = (position % columns + (columns - itemsInRow + 1) / 2 + ((hash % 19) - 9) / 105) * cellWidth;
    const cellY = (row + .47 + (((hash >>> 8) % 19) - 9) / 95) * cellHeight;
    let center: Point;
    if (continent) {
      center = index === 0 ? { x: -size * .13, y: height * .46 } : { x: width + size * .13, y: height * .56 };
    } else if (count === 1) {
      center = { x: shoreLeft + openWidth / 2, y: height / 2 - 12 };
    } else if (spread) {
      center = { x: shoreLeft + ANCHORS[position][0] * openWidth, y: ANCHORS[position][1] * height };
    } else {
      center = { x: shoreLeft + cellX, y: cellY };
    }
    const obstacle = { center, size, radius: size * .50 + Math.min(9, size * .12), land: LAND_TILES[sprite] };
    const coast = continent ? COASTS[sprite].filter(({ angle, radius }) => {
      const shore = polar(center, radius * size, angle);
      const gate = polar(center, obstacle.radius + 12, angle);
      const intoMap = Math.cos(angle) * (index === 0 ? 1 : -1);
      return intoMap > .46 && shore.x > 12 && shore.x < width - 12 && gate.y > 18 && gate.y < height - 18;
    }) : COASTS[sprite];
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
      compact: !spread && cellWidth < 105 && position > 7, labelWidth: Math.max(65, Math.min(164, cellWidth - 8)) };
  });
}
