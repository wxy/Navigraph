import type { OceanDayNode } from '../lib/graph/ocean-day.js';

export interface Island {
  site: string;
  records: number;
  docks: Dock[];
  arrivals: Arrival[];
}

export interface Dock {
  number: number;
  island: Island;
  arrivals: Arrival[];
}

export interface Ship {
  number: number;
  arrivals: Arrival[];
  voyages: number;
  coastalTrips: number;
}

export interface Route {
  from: Island;
  to: Island;
  crossings: number;
}

export interface Arrival {
  index: number;
  timestamp: number;
  ship: Ship;
  island: Island;
  dock: Dock;
  from?: Dock;
  route?: Route;
}

export function chartHistory(nodes: readonly OceanDayNode[]) {
  const islands = new Map<string, Island>();
  const docks = new Map<number, Dock>();
  const ships = new Map<number, Ship>();
  const routes = new Map<string, Route>();
  const arrivals: Arrival[] = [];
  let voyages = 0;
  let coastalTrips = 0;

  // The indexed day query returns newest first, including when timestamps tie.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const { site, tabId, timestamp, page } = nodes[index];
    let island = islands.get(site);
    if (!island) {
      island = { site, records: 0, docks: [], arrivals: [] };
      islands.set(site, island);
    }
    island.records++;
    let dock = docks.get(page);
    if (!dock) {
      dock = { number: island.docks.length + 1, island, arrivals: [] };
      island.docks.push(dock);
      docks.set(page, dock);
    }

    let ship = ships.get(tabId);
    if (!ship) {
      ship = { number: ships.size + 1, arrivals: [], voyages: 0, coastalTrips: 0 };
      ships.set(tabId, ship);
    }
    const from = ship.arrivals[ship.arrivals.length - 1]?.dock;
    if (from === dock) continue;

    let route: Route | undefined;
    if (from && from.island !== island) {
      const key = `${from.island.site}\n${island.site}`;
      route = routes.get(key);
      if (!route) {
        route = { from: from.island, to: island, crossings: 0 };
        routes.set(key, route);
      }
      route.crossings++;
      ship.voyages++;
      voyages++;
    } else if (from) {
      ship.coastalTrips++;
      coastalTrips++;
    }
    const arrival = { index: arrivals.length, timestamp, ship, island, dock, from, route };
    arrivals.push(arrival);
    ship.arrivals.push(arrival);
    island.arrivals.push(arrival);
    dock.arrivals.push(arrival);
  }

  return {
    islands: [...islands.values()].sort((a, b) => b.records - a.records || a.site.localeCompare(b.site)),
    ships: [...ships.values()],
    routes: [...routes.values()],
    arrivals,
    voyages,
    coastalTrips,
  };
}

export function lastArrival(ship: Ship, index: number): Arrival | undefined {
  const { arrivals } = ship;
  let low = 0;
  let high = arrivals.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (arrivals[mid].index <= index) low = mid + 1;
    else high = mid;
  }
  return arrivals[low - 1];
}
