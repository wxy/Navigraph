import { graphViewUrl, readHistoryDay, replaceHistorySelection } from '../lib/graph/location.js';
import { OCEAN_DAY_LIMIT } from '../lib/graph/ocean-day.js';
import { localDayRange } from '../lib/graph/tree-day.js';
import { sendToBackground } from '../lib/messaging/sender.js';
import { getSettingsService } from '../lib/settings/service.js';
import { I18n, _ } from '../lib/utils/i18n.js';
import type { BackgroundResponses } from '../types/messages/background.js';
import { OceanChart } from './chart.js';
import { chartHistory, type Arrival, type Island, type Ship } from './history.js';
import { prepareReplay, replayAt } from './replay.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const inputDate = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

async function initialize(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const settings = getSettingsService();
  await settings.initialize();
  const locale = params.get('locale') ?? settings.getSetting('forcedLocale') ?? 'system';
  await I18n.getInstance().setLocale(locale);
  document.documentElement.lang = (locale === 'system' ? chrome.i18n.getUILanguage() : locale).replace('_', '-');

  const initialDay = readHistoryDay(params);
  const initialSession = params.get('session') ?? undefined;
  const treeView = document.querySelector<HTMLAnchorElement>('#ocean-tree-view')!;
  const waterfallView = document.querySelector<HTMLAnchorElement>('#ocean-waterfall-view')!;
  const date = document.querySelector<HTMLInputElement>('#ocean-date')!;
  const counts = document.getElementById('ocean-counts')!;
  const status = document.getElementById('ocean-status')!;
  const play = document.querySelector<HTMLButtonElement>('#ocean-play')!;
  const playLabel = document.getElementById('ocean-play-label')!;
  const position = document.querySelector<HTMLInputElement>('#ocean-position')!;
  const shipPicker = document.querySelector<HTMLSelectElement>('#ocean-ship')!;
  const time = document.querySelector<HTMLTimeElement>('#ocean-time')!;
  const current = document.getElementById('ocean-current')!;
  const underwayLabel = document.getElementById('ocean-underway')!;
  const firstTime = document.getElementById('ocean-first-time')!;
  const lastTime = document.getElementById('ocean-last-time')!;
  const port = document.getElementById('ocean-port')!;
  const portVisits = document.getElementById('ocean-port-visits')!;
  const closePortButton = document.querySelector<HTMLButtonElement>('#ocean-port-close')!;
  const map = document.getElementById('ocean-map')!;
  const chart = new OceanChart(
    map,
    document.getElementById('ocean-islands')!,
    document.querySelector<HTMLCanvasElement>('#ocean-routes')!,
    document.querySelector<HTMLCanvasElement>('#ocean-ships')!,
    openPort,
  );
  let history = chartHistory([]);
  let replay = prepareReplay([]);
  let selectedShip: Ship | undefined;
  let lastPortButton: HTMLElement | undefined;
  let elapsed = 0;
  let describedIndex = -2;
  let describedUnderway = -1;
  let request = 0;
  let frame: number | undefined;
  let previousFrame = 0;

  function shipName(ship: Ship): string {
    return _('ocean_ship', '船 {0}', ship.number);
  }

  function draw(): void {
    const { fleet, current: shown, underway } = replayAt(replay, elapsed, !reducedMotion.matches);
    chart.showFleet(fleet, shown);
    const progress = Math.round(elapsed / 100) * 100;
    if (position.valueAsNumber !== progress) position.value = String(progress);
    if (describedUnderway !== underway) {
      describedUnderway = underway;
      underwayLabel.hidden = underway < 2;
      underwayLabel.textContent = underway >= 2 ? _('ocean_underway', '{0} 艘船同时航行', underway) : '';
    }
    const index = shown?.index ?? -1;
    if (index === describedIndex) return;
    describedIndex = index;
    time.textContent = shown ? timeFormat.format(shown.timestamp) : '–';
    time.dateTime = shown ? new Date(shown.timestamp).toISOString() : '';
    let place = shown?.island.site;
    if (shown?.route) place = `${shown.route.from.island.site} → ${shown.island.site}`;
    else if (shown?.from) {
      place = `${place} · ${_('ocean_coastal_move', '码头 {0} → 码头 {1}', shown.from.number, shown.dock.number)}`;
    }
    current.textContent = shown ? `${shipName(shown.ship)} · ${place}` : '';
    position.setAttribute('aria-valuetext', `${time.textContent} ${current.textContent}`.trim());
  }

  function setPlaying(playing: boolean): void {
    play.classList.toggle('playing', playing);
    map.classList.toggle('sailing', playing);
    playLabel.textContent = playing ? _('ocean_pause', '暂停') : _('ocean_play', '播放');
  }

  function pause(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    setPlaying(false);
  }

  function seek(time: number): void {
    pause();
    elapsed = time;
    draw();
  }

  function tick(now: number): void {
    if (previousFrame) elapsed = Math.min(replay.duration, elapsed + now - previousFrame);
    previousFrame = now;
    draw();
    if (elapsed === replay.duration) pause();
    else frame = requestAnimationFrame(tick);
  }

  function showTimeline(arrivals: Arrival[]): void {
    replay = prepareReplay(arrivals);
    describedIndex = -2;
    position.max = String(replay.duration);
    position.disabled = play.disabled = arrivals.length < 2;
    firstTime.textContent = arrivals.length ? timeFormat.format(arrivals[0].timestamp) : '';
    lastTime.textContent = arrivals.length ? timeFormat.format(arrivals[arrivals.length - 1].timestamp) : '';
    seek(replay.duration);
  }

  function closePort(restoreFocus = false): void {
    port.hidden = true;
    chart.selectIsland();
    if (restoreFocus) lastPortButton?.focus();
    lastPortButton = undefined;
  }

  function openPort(island: Island): void {
    lastPortButton = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    chart.selectIsland(island);
    document.getElementById('ocean-port-name')!.textContent = island.site;
    document.getElementById('ocean-port-count')!.textContent =
      _('ocean_port_counts', '{0} 条记录 · {1} 个码头', island.records.toLocaleString(), island.docks.length.toLocaleString());
    const fragment = document.createDocumentFragment();
    for (const arrival of island.arrivals) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.arrival = String(arrival.index);
      button.textContent = `${timeFormat.format(arrival.timestamp)} · ${shipName(arrival.ship)} · ${_('ocean_dock', '码头 {0}', arrival.dock.number)}`;
      item.append(button);
      fragment.append(item);
    }
    portVisits.replaceChildren(fragment);
    port.hidden = false;
    closePortButton.focus();
  }

  function applyShip(ship: Ship | undefined): void {
    selectedShip = ship;
    shipPicker.value = ship ? String(ship.number) : '';
    chart.focus(ship);
    showTimeline(ship?.arrivals ?? history.arrivals);
  }

  function updateViewLinks(day?: number): void {
    treeView.href = graphViewUrl('tree', day).href;
    waterfallView.href = graphViewUrl('waterfall', day, day === initialDay ? initialSession : undefined).href;
  }

  async function load(day?: number): Promise<void> {
    const token = ++request;
    updateViewLinks(day);
    if (day !== undefined) date.value = inputDate.format(day);
    closePort();
    history = chartHistory([]);
    chart.setHistory([], []);
    showTimeline([]);
    shipPicker.disabled = true;
    counts.textContent = '';
    status.hidden = false;
    status.classList.remove('limit');
    status.textContent = _('content_loading', '正在加载数据...');
    let response: BackgroundResponses.GetOceanDayResponse;
    try {
      response = await sendToBackground('getOceanDay', { date: day });
    } catch (error) {
      if (token !== request) return;
      console.error(error);
      status.textContent = _('ocean_history_error', '读取这一天的浏览记录失败。');
      return;
    }
    if (token !== request) return;
    date.value = inputDate.format(response.start);
    updateViewLinks(response.start);
    history = chartHistory(response.nodes);
    chart.setHistory(history.islands, history.routes);
    counts.textContent = _('ocean_counts', '{0} 座岛 · {1} 艘船 · 跨岛 {2} 段 · 沿岸 {3} 段',
      history.islands.length.toLocaleString(), history.ships.length.toLocaleString(),
      history.voyages.toLocaleString(), history.coastalTrips.toLocaleString());
    shipPicker.replaceChildren(new Option(_('ocean_all_ships', '所有标签页'), ''));
    const ranked = [...history.ships].sort((a, b) => b.voyages - a.voyages || b.coastalTrips - a.coastalTrips || a.number - b.number);
    for (const ship of ranked) {
      const label = _('ocean_ship_option', '船 {0} · 跨岛 {1} · 沿岸 {2}', ship.number, ship.voyages, ship.coastalTrips);
      shipPicker.add(new Option(label, String(ship.number)));
    }
    shipPicker.disabled = !history.ships.length;
    applyShip(undefined);
    status.hidden = Boolean(history.arrivals.length) && !response.truncated;
    status.classList.toggle('limit', response.truncated);
    status.textContent = response.truncated
      ? _('ocean_day_limit', '显示最近 {0} 条导航记录。', OCEAN_DAY_LIMIT.toLocaleString())
      : _('ocean_empty', '这一天还没有浏览记录。');
  }

  play.addEventListener('click', () => {
    if (frame !== undefined) {
      pause();
      return;
    }
    if (elapsed === replay.duration) seek(0);
    previousFrame = 0;
    setPlaying(true);
    frame = requestAnimationFrame(tick);
  });
  position.addEventListener('input', () => seek(position.valueAsNumber));
  shipPicker.addEventListener('change', () => {
    closePort();
    applyShip(history.ships[Number(shipPicker.value) - 1]);
  });
  closePortButton.addEventListener('click', () => closePort(true));
  port.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePort(true);
  });
  portVisits.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const arrival = history.arrivals[Number(button.dataset.arrival)];
    if (selectedShip && arrival.ship !== selectedShip) applyShip(undefined);
    seek(replay.arrivalsAt.get(arrival)!);
    closePort(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  reducedMotion.addEventListener('change', draw);
  date.addEventListener('change', () => {
    if (!date.value || !date.validity.valid) return;
    const [day] = localDayRange(new Date(`${date.value}T12:00:00`).getTime());
    replaceHistorySelection(day, day === initialDay ? initialSession : undefined);
    void load(day);
  });

  date.max = inputDate.format(Date.now());
  await load(initialDay);
}

void initialize();
