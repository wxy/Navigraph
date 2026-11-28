import { parse } from 'tldts';
import type { OceanDayNode } from '../lib/graph/ocean-day.js';
import { _ } from '../lib/utils/i18n.js';
import { islandName } from './island-name.js';

export const SHIP_IDLE_MS = 15 * 60 * 1000;
const COASTAL_LEGS_PER_SHIP = 6;

export interface Island {
  site: string;
  name: string;
  records: number;
  scale: 'small' | 'large' | 'continent';
  docks: Dock[];
  arrivals: Arrival[];
}

export interface Dock {
  id: number;
  number: number;
  name: string;
  island: Island;
  arrivals: Arrival[];
  ships: Set<Ship>;
}

export interface Ship {
  tabId: number;
  number: number;
  name: string;
  generation: number;
  arrivals: Arrival[];
}

export interface Arrival {
  index: number;
  nodeId: string;
  timestamp: number;
  sessionId: string;
  ship: Ship;
  island: Island;
  dock: Dock;
  previous?: Arrival;
  mooredVia?: Arrival;
}

export function siteHash(site: string): number {
  let hash = 0;
  for (let i = 0; i < site.length; i++) hash = (Math.imul(hash, 31) + site.charCodeAt(i)) | 0;
  return hash >>> 0;
}

export function chartHistory(nodes: readonly OceanDayNode[], language: string) {
  const dockNames = [
    _('ocean_pier_lighthouse', '灯塔码头'),
    _('ocean_pier_crown', '王冠码头'),
    _('ocean_pier_whitecliff', '白崖码头'),
    _('ocean_pier_fort', '海堡码头'),
    _('ocean_pier_northgate', '北门码头'),
    _('ocean_pier_customs', '海关码头'),
  ];
  const shipNames = [
    _('ocean_vessel_falcon', '海隼'),
    _('ocean_vessel_stag', '金鹿'),
    _('ocean_vessel_star', '晨星'),
    _('ocean_vessel_wind', '北风'),
    _('ocean_vessel_crown', '银冠'),
    _('ocean_vessel_fortuna', '福尔图娜'),
    _('ocean_vessel_elmo', '圣埃尔莫'),
    _('ocean_vessel_westerly', '西风'),
    _('ocean_vessel_petrel', '风暴海燕'),
    _('ocean_vessel_queen', '海上女王'),
    _('ocean_vessel_trade', '信风'),
    _('ocean_vessel_albatross', '信天翁'),
  ];
  const sites = new Map<string, { stem: string; records: number; pages: Set<number> }>();
  const domains = new Map<string, { site: string; stem: string }>();
  // The indexed day query returns newest first, including when timestamps tie.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const { site: host, page } = nodes[index];
    let identity = domains.get(host);
    if (!identity) {
      const { domain, domainWithoutSuffix } = parse(host, { allowPrivateDomains: true, extractHostname: false });
      identity = { site: domain ?? host, stem: domainWithoutSuffix ?? host };
      domains.set(host, identity);
    }
    const { site, stem } = identity;
    let visits = sites.get(site);
    if (!visits) {
      visits = { stem, records: 0, pages: new Set() };
      sites.set(site, visits);
    }
    visits.records++;
    visits.pages.add(page);
  }

  const islands = new Map<string, Island>();
  const pageDocks = new Map<number, Dock>();
  let dockId = 0;
  for (const [site, { stem, records, pages }] of sites) {
    const scale = records >= 100 && pages.size >= 12 ? 'continent' : records >= 30 && pages.size >= 6 ? 'large' : 'small';
    const island: Island = { site, name: islandName(site, stem, language), records, scale, docks: [], arrivals: [] };
    const limit = scale === 'continent' ? 6 : scale === 'large' ? 5 : 3;
    const nameOffset = siteHash(site) % dockNames.length;
    let assigned = 0;
    for (const page of pages) {
      const slot = assigned++ % limit;
      const dock = island.docks[slot] ?? {
        id: ++dockId,
        number: slot + 1,
        name: dockNames[(nameOffset + slot) % dockNames.length],
        island,
        arrivals: [],
        ships: new Set<Ship>(),
      };
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
    const { id: nodeId, tabId, timestamp, page, sessionId } = nodes[index];
    const dock = pageDocks.get(page)!;
    const { island } = dock;
    let tab = tabs.get(tabId);
    const last = tab?.ship.arrivals.at(-1);
    const previous = last?.sessionId === sessionId && last.dock !== dock ? last : undefined;
    const coastal = previous?.island === island;
    if (!tab || last!.sessionId !== sessionId || timestamp - last!.timestamp >= SHIP_IDLE_MS
      || (coastal && tab.coastalLegs >= COASTAL_LEGS_PER_SHIP)) {
      const stem = shipNames[ships.length % shipNames.length];
      const series = Math.floor(ships.length / shipNames.length) + 1;
      const name = series === 1 ? _('ocean_vessel_name', '{0}号', stem) : _('ocean_vessel_name_repeat', '{0}{1}号', stem, series);
      const ship: Ship = { tabId, number: ships.length + 1, name, generation: (tab?.ship.generation ?? -1) + 1, arrivals: [] };
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
    // A visit at the same dock preserves the pose at the end of the last voyage.
    const mooredVia = last?.ship === ship && last.dock === dock ? (last.previous ? last : last.mooredVia) : undefined;
    const arrival = { index: arrivals.length, nodeId, timestamp, sessionId, ship, island, dock, previous, mooredVia };
    arrivals.push(arrival);
    ship.arrivals.push(arrival);
    island.arrivals.push(arrival);
    dock.arrivals.push(arrival);
    dock.ships.add(ship);
    // A replacement can launch here before it has made its first arrival here.
    previous?.dock.ships.add(ship);
  }

  return {
    islands: [...islands.values()].sort((a, b) => b.records - a.records || a.site.localeCompare(b.site)),
    ships,
    arrivals,
    voyages,
    coastalTrips,
  };
}
