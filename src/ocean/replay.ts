import type { Arrival, Ship } from './history.js';

interface TimedArrival {
  arrival: Arrival;
  start: number;
  end: number;
}

export interface ShipPosition {
  arrival: Arrival;
  fraction?: number;
}

export function prepareReplay(arrivals: readonly Arrival[]) {
  const tracks = new Map<Ship, TimedArrival[]>();
  const arrivalsAt = new Map<Arrival, number>();
  let previousTimestamp = arrivals[0]?.timestamp ?? 0;
  let suggestedStart = 0;
  let duration = 0;
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
    const end = start + (arrival.route ? 4800 : arrival.from ? 1800 : 0);
    track.push({ arrival, start, end });
    arrivalsAt.set(arrival, end);
    duration = Math.max(duration, end);
  }
  return { tracks: [...tracks.values()], arrivalsAt, duration };
}

export function replayAt(replay: ReturnType<typeof prepareReplay>, time: number, animate: boolean) {
  const fleet: ShipPosition[] = [];
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
    let leg = track[low - 1];
    if (!leg) continue;
    if (!animate && time < leg.end) leg = track[low - 2];
    if (!leg) continue;

    const fraction = time < leg.end ? (time - leg.start) / (leg.end - leg.start) : undefined;
    fleet.push({ arrival: leg.arrival, fraction });
    if (fraction !== undefined) underway++;
    const recordAt = fraction === undefined ? leg.end : time + 1 + leg.start;
    if (recordAt >= currentAt) {
      current = leg.arrival;
      currentAt = recordAt;
    }
  }
  return { fleet, current, underway };
}
