import { SHIP_IDLE_MS, type Arrival, type Dock, type Island, type Ship } from './history.js';

export const TRAIL_FADE = 3200;

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

export function prepareReplay(arrivals: readonly Arrival[]) {
  const tracks = new Map<Ship, ShipTrack>();
  const tabs = new Map<number, TimedArrival>();
  const arrivalsAt = new Map<Arrival, number>();
  let previousTimestamp = arrivals[0]?.timestamp ?? 0;
  let suggestedStart = 0;
  let duration = 0;
  let lastVoyage = 0;
  for (const arrival of arrivals) {
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
  return { tracks: [...tracks.values()], arrivalsAt, duration: Math.max(duration, lastVoyage ? lastVoyage + TRAIL_FADE : 0) };
}

export function replayAt(replay: ReturnType<typeof prepareReplay>, time: number, animate: boolean) {
  const positions: (ShipPosition & { finished: boolean })[] = [];
  const trails: TimedArrival[] = [];
  let current: Arrival | undefined;
  let currentAt = -1;
  let latest: Arrival | undefined;
  let underway = 0;
  let timestamp: number | undefined;
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
    if (timestamp === undefined || shipTime >= timestamp) {
      timestamp = shipTime;
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
    if (position.parked || (position.finished && timestamp! - position.timestamp >= SHIP_IDLE_MS)) {
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
  return { fleet: [...parked, ...fleet], trails, current: underway ? current : latest, underway, timestamp };
}
