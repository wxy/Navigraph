import { getDomain } from 'tldts';
import type { OceanDayNode } from '../lib/graph/ocean-day.js';
import { _ } from '../lib/utils/i18n.js';

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

export function chartHistory(nodes: readonly OceanDayNode[]) {
  const dockNames = [
    _('ocean_pier_lantern', '灯湾码头'),
    _('ocean_pier_tide', '潮汐码头'),
    _('ocean_pier_sand', '白沙码头'),
    _('ocean_pier_reef', '礁石码头'),
    _('ocean_pier_windward', '迎风码头'),
    _('ocean_pier_mist', '雾湾码头'),
  ];
  const shipNames = [
    _('ocean_vessel_gull', '白鸥'),
    _('ocean_vessel_tide', '潮声'),
    _('ocean_vessel_star', '晨星'),
    _('ocean_vessel_wind', '北风'),
    _('ocean_vessel_lantern', '渡灯'),
    _('ocean_vessel_sail', '远帆'),
    _('ocean_vessel_bay', '晴湾'),
    _('ocean_vessel_dusk', '暮潮'),
    _('ocean_vessel_petrel', '海燕'),
    _('ocean_vessel_moon', '月影'),
    _('ocean_vessel_blue', '蓝湾'),
    _('ocean_vessel_cloud', '流云'),
  ];
  const sites = new Map<string, { records: number; pages: Set<number> }>();
  const domains = new Map<string, string>();
  // The indexed day query returns newest first, including when timestamps tie.
  for (let index = nodes.length - 1; index >= 0; index--) {
    const { site: host, page } = nodes[index];
    let site = domains.get(host);
    if (site === undefined) {
      site = getDomain(host, { allowPrivateDomains: true, extractHostname: false }) ?? host;
      domains.set(host, site);
    }
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
