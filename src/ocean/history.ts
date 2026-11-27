import type { OceanDayNode } from '../lib/graph/ocean-day.js';

export const SHIP_IDLE_MS = 15 * 60 * 1000;
const COASTAL_LEGS_PER_SHIP = 6;

export interface Island {
  site: string;
  records: number;
  scale: 'small' | 'large' | 'continent';
  docks: Dock[];
  arrivals: Arrival[];
}

export interface Dock {
  id: number;
  number: number;
  island: Island;
  arrivals: Arrival[];
}

export interface Ship {
  tabId: number;
  number: number;
  generation: number;
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
  const sites = new Map<string, { records: number; pages: Set<number> }>();
  // The indexed day query returns newest first, including when timestamps tie.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const { site, page } = nodes[index];
    let visits = sites.get(site);
    if (!visits) {
      visits = { records: 0, pages: new Set() };
      sites.set(site, visits);
    }
    visits.records++;
    visits.pages.add(page);
  }

  const islands = new Map<string, Island>();
  const pageDocks = new Map<number, Dock>();
  let dockId = 0;
  for (const [site, { records, pages }] of sites) {
    const scale = records >= 100 && pages.size >= 12 ? 'continent' : records >= 30 && pages.size >= 6 ? 'large' : 'small';
    const island: Island = { site, records, scale, docks: [], arrivals: [] };
    const limit = scale === 'continent' ? 6 : scale === 'large' ? 5 : 3;
    let assigned = 0;
    for (const page of pages) {
      const slot = assigned++ % limit;
      const dock = island.docks[slot] ?? { id: ++dockId, number: slot + 1, island, arrivals: [] };
      island.docks[slot] = dock;
      pageDocks.set(page, dock);
    }
    islands.set(site, island);
  }

  const ships: Ship[] = [];
  const tabs = new Map<number, { ship: Ship; coastalLegs: number }>();
  const arrivals: Arrival[] = [];
  let voyages = 0;
  let coastalTrips = 0;

  for (let index = nodes.length - 1; index >= 0; index--) {
    const { tabId, timestamp, page, sessionId } = nodes[index];
    const dock = pageDocks.get(page)!;
    const { island } = dock;
    let tab = tabs.get(tabId);
    const last = tab?.ship.arrivals.at(-1);
    const previous = last?.sessionId === sessionId && last.dock !== dock ? last : undefined;
    const coastal = previous?.island === island;
    if (!tab || last!.sessionId !== sessionId || timestamp - last!.timestamp >= SHIP_IDLE_MS
      || (coastal && tab.coastalLegs >= COASTAL_LEGS_PER_SHIP)) {
      const ship = { tabId, number: ships.length + 1, generation: (tab?.ship.generation ?? -1) + 1, arrivals: [] };
      ships.push(ship);
      tab = { ship, coastalLegs: 0 };
      tabs.set(tabId, tab);
    }
    const { ship } = tab;
    if (previous) {
      if (coastal) {
        coastalTrips++;
        tab.coastalLegs++;
      } else {
        voyages++;
        tab.coastalLegs = 0;
      }
    }
    const arrival = { index: arrivals.length, timestamp, sessionId, ship, island, dock, previous };
    arrivals.push(arrival);
    ship.arrivals.push(arrival);
    island.arrivals.push(arrival);
    dock.arrivals.push(arrival);
  }

  return {
    islands: [...islands.values()].sort((a, b) => b.records - a.records || a.site.localeCompare(b.site)),
    ships,
    arrivals,
    voyages,
    coastalTrips,
  };
}
