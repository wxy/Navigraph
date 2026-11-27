import { graphViewUrl, readHistoryDay, replaceHistorySelection } from '../lib/graph/location.js';
import { OCEAN_DAY_LIMIT } from '../lib/graph/ocean-day.js';
import { localDayRange } from '../lib/graph/tree-day.js';
import { sendToBackground } from '../lib/messaging/sender.js';
import { getSettingsService } from '../lib/settings/service.js';
import { I18n, _ } from '../lib/utils/i18n.js';
import type { BackgroundResponses } from '../types/messages/background.js';
import { loadOceanArt } from './art.js';
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
  const sessionPicker = document.querySelector<HTMLSelectElement>('#ocean-session')!;
  const musicOption = document.querySelector<HTMLInputElement>('#ocean-music')!;
  const music = document.querySelector<HTMLAudioElement>('#ocean-music-track')!;
  const time = document.querySelector<HTMLTimeElement>('#ocean-time')!;
  const current = document.getElementById('ocean-current')!;
  const underwayLabel = document.getElementById('ocean-underway')!;
  const firstTime = document.getElementById('ocean-first-time')!;
  const lastTime = document.getElementById('ocean-last-time')!;
  const port = document.getElementById('ocean-port')!;
  const portVisits = document.getElementById('ocean-port-visits')!;
  const closePortButton = document.querySelector<HTMLButtonElement>('#ocean-port-close')!;
  const map = document.getElementById('ocean-map')!;
  const art = await loadOceanArt().catch(error => {
    console.error('Unable to load sea chart artwork', error);
    status.textContent = _('content_init_failed', '初始化失败').replace(/[:：]\s*$/, '');
  });
  if (!art) return;
  const chart = new OceanChart(
    map,
    document.getElementById('ocean-islands')!,
    document.querySelector<HTMLCanvasElement>('#ocean-water')!,
    document.querySelector<HTMLCanvasElement>('#ocean-ships')!,
    art,
    timeFormat,
    openPort,
  );
  let history = chartHistory([]);
  let replay = prepareReplay([]);
  let dayData: BackgroundResponses.GetOceanDayResponse | undefined;
  let lastPortButton: HTMLElement | undefined;
  let elapsed = 0;
  let describedIndex = -2;
  let describedUnderway = -1;
  let request = 0;
  let frame: number | undefined;
  let previousFrame = 0;
  musicOption.checked = false;
  music.volume = .32;

  function shipName(ship: Ship): string {
    return _('ocean_ship', '船 {0}', ship.number);
  }

  function draw(): void {
    const animate = !reducedMotion.matches;
    const { fleet, trails, current: shown, underway } = replayAt(replay, elapsed, animate);
    chart.showFleet(fleet, trails, elapsed, shown, animate);
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
    if (shown?.previous && shown.previous.island !== shown.island) {
      place = `${shown.previous.island.site} → ${shown.island.site}`;
    } else if (shown?.previous) {
      place = `${place} · ${_('ocean_coastal_move', '码头 {0} → 码头 {1}', shown.previous.dock.number, shown.dock.number)}`;
    }
    current.textContent = shown ? `${shipName(shown.ship)} · ${place}` : '';
    position.setAttribute('aria-valuetext', `${time.textContent} ${current.textContent}`.trim());
  }

  function positionMusic(): void {
    if (Number.isFinite(music.duration) && music.duration > 0) music.currentTime = elapsed / 1000 % music.duration;
  }

  function syncMusic(playing: boolean): void {
    music.muted = !musicOption.checked;
    if (!playing || !musicOption.checked) {
      music.pause();
      return;
    }
    positionMusic();
    void music.play().catch(error => {
      if (error.name === 'AbortError') return;
      console.error('Unable to play the sea chart soundtrack', error);
      musicOption.checked = false;
      music.muted = true;
    });
  }

  function setPlaying(playing: boolean): void {
    play.classList.toggle('playing', playing);
    if (!playing) chart.waves.stop();
    playLabel.textContent = playing ? _('ocean_pause', '暂停') : _('ocean_play', '播放');
    syncMusic(playing);
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
    else {
      if (!reducedMotion.matches) chart.waves.draw(now);
      frame = requestAnimationFrame(tick);
    }
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

  function applySession(): void {
    if (!dayData) return;
    const session = sessionPicker.value;
    history = chartHistory(session ? dayData.nodes.filter(node => node.sessionId === session) : dayData.nodes);
    chart.setHistory(history.islands);
    counts.textContent = _('ocean_counts', '{0} 座岛 · {1} 艘船 · 跨岛 {2} 段 · 沿岸 {3} 段',
      history.islands.length.toLocaleString(), history.ships.length.toLocaleString(),
      history.voyages.toLocaleString(), history.coastalTrips.toLocaleString());
    updateViewLinks(dayData.start, session);
    showTimeline(history.arrivals);
  }

  function updateViewLinks(day?: number, session?: string): void {
    treeView.href = graphViewUrl('tree', day).href;
    waterfallView.href = graphViewUrl('waterfall', day, session || (day === initialDay ? initialSession : undefined)).href;
  }

  async function load(day?: number): Promise<void> {
    const token = ++request;
    updateViewLinks(day);
    if (day !== undefined) date.value = inputDate.format(day);
    closePort();
    dayData = undefined;
    history = chartHistory([]);
    chart.setHistory([]);
    showTimeline([]);
    sessionPicker.replaceChildren(new Option(_('ocean_all_sessions', '全部会话'), ''));
    sessionPicker.disabled = true;
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
    dayData = response;
    for (const session of response.sessions.sort((a, b) => a.firstVisit - b.firstVisit)) {
      const firstVisit = timeFormat.format(session.firstVisit);
      sessionPicker.add(new Option(session.title ? `${firstVisit} · ${session.title}` : firstVisit, session.id));
    }
    sessionPicker.disabled = !response.sessions.length;
    applySession();
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
  musicOption.addEventListener('change', () => syncMusic(frame !== undefined));
  music.addEventListener('loadedmetadata', positionMusic);
  sessionPicker.addEventListener('change', () => {
    closePort();
    applySession();
  });
  closePortButton.addEventListener('click', () => closePort(true));
  port.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePort(true);
  });
  portVisits.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    const arrival = history.arrivals[Number(button.dataset.arrival)];
    seek(replay.arrivalsAt.get(arrival)!);
    closePort(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) chart.waves.stop();
    draw();
  });
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
