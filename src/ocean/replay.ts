import { SHIP_IDLE_MS, type Arrival, type Dock, type Island, type Ship } from './history.js';

export const TRAIL_FADE = 3200;
const CROWDED_CHART = 12;
const ISLAND_LEAD = 1400;
const ISLAND_STAY = 3600;
const ISLAND_FADE = 520;

export function easeTravel(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

export interface TimedArrival {
  arrival: Arrival;
  start: number;
  end: number;
}

export interface ShipPosition {
  arrival: Arrival;
  timestamp: number;
  fraction?: number;
  parked?: boolean;
}

interface ShipTrack {
  legs: TimedArrival[];
  replacedAt: number;
}

interface IslandWindow {
  from: number;
  until: number;
}

function islandSchedule(islands: Set<Island>, tracks: Iterable<ShipTrack>): Map<Island, IslandWindow[]> | undefined {
  if (islands.size <= CROWDED_CHART) return;
  const schedule = new Map<Island, IslandWindow[]>();
  function include(island: Island, from: number, until: number): void {
    if (island.scale !== 'small') return;
    const existing = schedule.get(island);
    if (existing) existing.push({ from, until });
    else schedule.set(island, [{ from, until }]);
  }
  for (const { legs } of tracks) {
    for (const { arrival, start, end } of legs) {
      include(arrival.island, start - ISLAND_LEAD, end + ISLAND_STAY);
      const origin = arrival.previous?.island;
      if (origin && origin !== arrival.island) include(origin, start - ISLAND_LEAD, end + 200);
    }
  }
  for (const [island, visits] of schedule) {
    const windows: IslandWindow[] = [];
    for (const visit of visits.sort((a, b) => a.from - b.from)) {
      const latest = windows.at(-1);
      if (latest && visit.from <= latest.until + ISLAND_FADE) latest.until = Math.max(latest.until, visit.until);
      else windows.push(visit);
    }
    schedule.set(island, windows);
  }
  return schedule;
}

export function prepareReplay(arrivals: readonly Arrival[]) {
  const tracks = new Map<Ship, ShipTrack>();
  const tabs = new Map<number, TimedArrival>();
  const arrivalsAt = new Map<Arrival, number>();
  const islands = new Set<Island>();
  let previousTimestamp = arrivals[0]?.timestamp ?? 0;
  let suggestedStart = 0;
  let duration = 0;
  let lastVoyage = 0;
  for (const arrival of arrivals) {
    islands.add(arrival.island);
    if (arrivalsAt.size) {
      const gap = arrival.timestamp - previousTimestamp;
      suggestedStart += Math.min(500, 100 * (1 + Math.floor(Math.log10(1 + gap / 1000))));
    }
    previousTimestamp = arrival.timestamp;
    let track = tracks.get(arrival.ship);
    if (!track) {
      track = { legs: [], replacedAt: Infinity };
      tracks.set(arrival.ship, track);
    }
    const previous = tabs.get(arrival.ship.tabId);
    // A tab's next leg waits for its previous vessel to dock, including when it switches vessels.
    const start = previous ? Math.max(suggestedStart, previous.end + 300) : suggestedStart;
    if (previous && previous.arrival.ship !== arrival.ship) tracks.get(previous.arrival.ship)!.replacedAt = start;
    const departure = arrival.previous;
    const end = start + (departure ? departure.island === arrival.island ? 1800 : 4800 : 0);
    if (departure) lastVoyage = Math.max(lastVoyage, end);
    const leg = { arrival, start, end };
    track.legs.push(leg);
    tabs.set(arrival.ship.tabId, leg);
    arrivalsAt.set(arrival, end);
    duration = Math.max(duration, end);
  }
  return {
    tracks: [...tracks.values()], arrivalsAt, islandWindows: islandSchedule(islands, tracks.values()),
    duration: Math.max(duration, lastVoyage ? lastVoyage + TRAIL_FADE : 0),
    timeRange: arrivals.length ? { start: arrivals[0].timestamp, end: arrivals[arrivals.length - 1].timestamp } : undefined,
  };
}

export function islandVisibilityAt(replay: ReturnType<typeof prepareReplay>, time: number, animate: boolean): Map<Island, number> | undefined {
  if (!replay.islandWindows) return;
  const visibility = new Map<Island, number>();
  for (const [island, windows] of replay.islandWindows) {
    let low = 0;
    let high = windows.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (windows[mid].from <= time) low = mid + 1;
      else high = mid;
    }
    const window = windows[low - 1];
    if (!window || time >= window.until + ISLAND_FADE) continue;
    const progress = Math.min(1, (time - window.from) / ISLAND_FADE, (window.until + ISLAND_FADE - time) / ISLAND_FADE);
    const opacity = animate ? Math.round(easeTravel(progress) * 20) / 20 : 1;
    if (opacity > 0) visibility.set(island, opacity);
  }
  return visibility;
}

export function replayAt(replay: ReturnType<typeof prepareReplay>, time: number, animate: boolean) {
  const positions: (ShipPosition & { finished: boolean })[] = [];
  const trails: TimedArrival[] = [];
  let current: Arrival | undefined;
  let currentAt = -1;
  let latest: Arrival | undefined;
  let underway = 0;
  let latestShipTime: number | undefined;
  for (const { legs, replacedAt } of replay.tracks) {
    let low = 0;
    let high = legs.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (legs[mid].start <= time) low = mid + 1;
      else high = mid;
    }
    if (animate) {
      for (let index = low - 1; index >= 0 && legs[index].end > time - TRAIL_FADE; index--) {
        const voyage = legs[index];
        if (voyage.arrival.previous && voyage.start < time) trails.push(voyage);
      }
    }
    let leg = legs[low - 1];
    if (!leg) continue;
    if (!animate && time < leg.end) leg = legs[low - 2];
    if (!leg) continue;

    const fraction = time < leg.end ? (time - leg.start) / (leg.end - leg.start) : undefined;
    const { arrival } = leg;
    const shipTime = fraction === undefined
      ? arrival.timestamp
      : arrival.previous!.timestamp + (arrival.timestamp - arrival.previous!.timestamp) * fraction;
    if (latestShipTime === undefined || shipTime >= latestShipTime) {
      latestShipTime = shipTime;
      latest = arrival;
    }
    positions.push({ arrival, timestamp: shipTime, fraction, parked: time >= replacedAt, finished: time >= leg.end && leg === legs.at(-1) });
    if (fraction !== undefined) underway++;
    const recordAt = fraction === undefined ? leg.end : time + 1 + leg.start;
    if (recordAt >= currentAt) {
      current = leg.arrival;
      currentAt = recordAt;
    }
  }

  const fleet: ShipPosition[] = [];
  const idleByDock = new Map<Dock, ShipPosition>();
  for (const position of positions) {
    if (position.parked || (position.finished && latestShipTime! - position.timestamp >= SHIP_IDLE_MS)) {
      const { dock } = position.arrival;
      const other = idleByDock.get(dock);
      if (!other || other.timestamp <= position.timestamp) idleByDock.set(dock, { ...position, parked: true });
    } else {
      fleet.push(position);
    }
  }
  const parked: ShipPosition[] = [];
  const parkedCounts = new Map<Island, number>();
  for (const position of [...idleByDock.values()].sort((a, b) => b.timestamp - a.timestamp)) {
    const { island } = position.arrival;
    const count = parkedCounts.get(island) ?? 0;
    if (count >= (island.scale === 'small' ? 1 : 2)) continue;
    parkedCounts.set(island, count + 1);
    parked.push(position);
  }
  return { fleet: [...parked, ...fleet], trails, current: underway ? current : latest, underway };
}
