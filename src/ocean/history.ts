import type { OceanDayNode } from '../lib/graph/ocean-day.js';

export interface Island {
  site: string;
  records: number;
  docks: Dock[];
  arrivals: Arrival[];
}

export interface Dock {
  page: number;
  number: number;
  island: Island;
  arrivals: Arrival[];
}

export interface Ship {
  tabId: number;
  number: number;
  arrivals: Arrival[];
}

export interface Arrival {
  index: number;
  timestamp: number;
  sessionId: string;
  ship: Ship;
  island: Island;
  dock: Dock;
  previous?: Arrival;
}

export function chartHistory(nodes: readonly OceanDayNode[]) {
  const islands = new Map<string, Island>();
  const docks = new Map<number, Dock>();
  const ships = new Map<number, Ship>();
  const arrivals: Arrival[] = [];
  let voyages = 0;
  let coastalTrips = 0;

  // The indexed day query returns newest first, including when timestamps tie.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const { site, tabId, timestamp, page, sessionId } = nodes[index];
    let island = islands.get(site);
    if (!island) {
      island = { site, records: 0, docks: [], arrivals: [] };
      islands.set(site, island);
    }
    island.records++;
    let dock = docks.get(page);
    if (!dock) {
      dock = { page, number: island.docks.length + 1, island, arrivals: [] };
      island.docks.push(dock);
      docks.set(page, dock);
    }

    let ship = ships.get(tabId);
    if (!ship) {
      ship = { tabId, number: ships.size + 1, arrivals: [] };
      ships.set(tabId, ship);
    }
    const last = ship.arrivals.at(-1);
    const previous = last?.sessionId === sessionId && last?.dock !== dock ? last : undefined;
    if (previous) {
      if (previous.island === island) coastalTrips++;
      else voyages++;
    }
    const arrival = { index: arrivals.length, timestamp, sessionId, ship, island, dock, previous };
    arrivals.push(arrival);
    ship.arrivals.push(arrival);
    island.arrivals.push(arrival);
    dock.arrivals.push(arrival);
  }

  return {
    islands: [...islands.values()].sort((a, b) => b.records - a.records || a.site.localeCompare(b.site)),
    ships: [...ships.values()],
    arrivals,
    voyages,
    coastalTrips,
  };
}
