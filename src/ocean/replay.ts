import type { Arrival, Ship } from './history.js';

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
}

export function prepareReplay(arrivals: readonly Arrival[]) {
  const tracks = new Map<Ship, TimedArrival[]>();
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
      track = [];
      tracks.set(arrival.ship, track);
    }
    const previous = track[track.length - 1];
    // A ship leaves only after its previous leg docks. Other ships can sail at the same time.
    const start = previous ? Math.max(suggestedStart, previous.end + 300) : suggestedStart;
    const departure = arrival.previous;
    const end = start + (departure ? departure.island === arrival.island ? 1800 : 4800 : 0);
    if (departure) lastVoyage = Math.max(lastVoyage, end);
    track.push({ arrival, start, end });
    arrivalsAt.set(arrival, end);
    duration = Math.max(duration, end);
  }
  return { tracks: [...tracks.values()], arrivalsAt, duration: Math.max(duration, lastVoyage ? lastVoyage + TRAIL_FADE : 0) };
}

export function replayAt(replay: ReturnType<typeof prepareReplay>, time: number, animate: boolean) {
  const fleet: ShipPosition[] = [];
  const trails: TimedArrival[] = [];
  let current: Arrival | undefined;
  let currentAt = -1;
  let underway = 0;
  for (const track of replay.tracks) {
    let low = 0;
    let high = track.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (track[mid].start <= time) low = mid + 1;
      else high = mid;
    }
    if (animate) {
      for (let index = low - 1; index >= 0 && track[index].end > time - TRAIL_FADE; index--) {
        const voyage = track[index];
        if (voyage.arrival.previous && voyage.start < time) trails.push(voyage);
      }
    }
    let leg = track[low - 1];
    if (!leg) continue;
    if (!animate && time < leg.end) leg = track[low - 2];
    if (!leg) continue;

    const fraction = time < leg.end ? (time - leg.start) / (leg.end - leg.start) : undefined;
    const { arrival } = leg;
    const timestamp = fraction === undefined
      ? arrival.timestamp
      : arrival.previous!.timestamp + (arrival.timestamp - arrival.previous!.timestamp) * fraction;
    fleet.push({ arrival, timestamp, fraction });
    if (fraction !== undefined) underway++;
    const recordAt = fraction === undefined ? leg.end : time + 1 + leg.start;
    if (recordAt >= currentAt) {
      current = leg.arrival;
      currentAt = recordAt;
    }
  }
  return { fleet, trails, current, underway };
}
