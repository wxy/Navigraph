import { CalendarSessionSelector } from '../lib/graph/CalendarSessionSelector.js';
import { graphViewUrl, readHistoryDay, replaceHistorySelection } from '../lib/graph/location.js';
import { renderNodeDetails } from '../lib/graph/node-details.js';
import { OCEAN_DAY_LIMIT } from '../lib/graph/ocean-day.js';
import { isTrackingUrl } from '../lib/graph/query.js';
import { formatGraphDuration, graphDateFormat, setupGraphCalendar, setupGraphOptions } from '../lib/graph/toolbar.js';
import { localDayRange } from '../lib/graph/tree-day.js';
import { sendToBackground } from '../lib/messaging/sender.js';
import { getSettingsService } from '../lib/settings/service.js';
import { I18n, _ } from '../lib/utils/i18n.js';
import type { BackgroundResponses } from '../types/messages/background.js';
import type { SessionSummary } from '../types/session-types.js';
import { getThemeManager } from '../content/utils/theme-manager.js';
import { loadOceanArt } from './art.js';
import { OceanChart } from './chart.js';
import { chartHistory, type Arrival, type Island, type Ship } from './history.js';
import { ChartLight } from './light.js';
import { islandVisibilityAt, prepareReplay, replayAt } from './replay.js';
import { paintOceanImage } from './snapshot.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SURFACE_SPEED = 5 / 1000;
// Vector from the base of the arrow to its tip in the unrotated artwork.
const WIND_ART_ANGLE = Math.atan2(-23, 18);

function wrapSurface(offset: number, period: number): number {
  // The tiled layer extends to the right and below the chart by one period.
  return -((-offset % period + period) % period);
}

async function initialize(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const settings = getSettingsService();
  await settings.initialize();
  const locale = params.get('locale') ?? settings.getSetting('forcedLocale') ?? 'system';
  await I18n.getInstance().setLocale(locale);
  document.documentElement.lang = (locale === 'system' ? chrome.i18n.getUILanguage() : locale).replace('_', '-');
  await getThemeManager().initialize();
  setupGraphOptions();
  document.getElementById('view-switcher-container')?.setAttribute('aria-label', _('content_view', '视图'));

  const initialDay = readHistoryDay(params);
  const initialSession = params.get('session') ?? undefined;
  const treeView = document.querySelector<HTMLAnchorElement>('#ocean-tree-view')!;
  const waterfallView = document.querySelector<HTMLAnchorElement>('#ocean-waterfall-view')!;
  const dateLabel = document.getElementById('graph-date-value')!;
  const duration = document.getElementById('graph-duration')!;
  const today = document.getElementById('graph-today')!;
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
  const portName = document.getElementById('ocean-port-name')!;
  const portList = document.getElementById('ocean-port-list')!;
  const portVisits = document.getElementById('ocean-port-visits')!;
  const closePortButton = document.querySelector<HTMLButtonElement>('#ocean-port-close')!;
  const backButton = document.querySelector<HTMLButtonElement>('#ocean-port-back')!;
  const visit = document.getElementById('ocean-visit')!;
  const visitLocation = document.getElementById('ocean-visit-location')!;
  const visitStatus = document.getElementById('ocean-visit-status')!;
  const visitDetails = document.getElementById('ocean-visit-details')!;
  const map = document.getElementById('ocean-map')!;
  const surface = document.getElementById('ocean-surface')!;
  const tileSize = Number.parseFloat(getComputedStyle(map).getPropertyValue('--surface-period'));
  const bearing = Math.random() * Math.PI * 2;
  const surfaceVelocityX = -Math.cos(bearing) * SURFACE_SPEED;
  const surfaceVelocityY = -Math.sin(bearing) * SURFACE_SPEED;
  const wind = document.querySelector<HTMLImageElement>('#ocean-wind')!;
  wind.alt = _('ocean_surface_direction', '海面移动方向');
  wind.style.rotate = `${Math.atan2(surfaceVelocityY, surfaceVelocityX) - WIND_ART_ANGLE}rad`;
  wind.hidden = false;
  const art = await loadOceanArt().catch(error => {
    console.error('Unable to load sea chart artwork', error);
    status.textContent = _('content_init_failed', '初始化失败').replace(/[:：]\s*$/, '');
  });
  if (!art) return;
  const chart = new OceanChart(
    map,
    document.getElementById('ocean-islands')!,
    document.getElementById('ocean-shallows')!,
    document.querySelector<HTMLCanvasElement>('#ocean-water')!,
    document.getElementById('ocean-piers')!,
    document.querySelector<HTMLCanvasElement>('#ocean-ships')!,
    document.getElementById('ocean-ship-targets')!,
    art,
    timeFormat,
    openPort,
    arrival => { void openVisit(arrival, true); },
  );
  const light = new ChartLight(
    map,
    document.querySelector<HTMLCanvasElement>('#ocean-moon')!,
    art.celestial,
  );
  let history = chartHistory([]);
  let replay = prepareReplay([]);
  let dayData: BackgroundResponses.GetOceanDayResponse | undefined;
  let portIsland: Island | undefined;
  let selectedVisit: { nodeId: string; ship?: Ship } | undefined;
  let elapsed = 0;
  let describedIndex = -2;
  let describedSecond = -1;
  let describedUnderway = -1;
  let requestedDay = initialDay;
  let calendarSessions: SessionSummary[] = [];
  let request = 0;
  let refreshPending = false;
  let refreshing = false;
  let refreshTimer: number | undefined;
  let frame: number | undefined;
  let previousFrame = 0;
  let surfaceX = 0;
  let surfaceY = 0;
  const calendar = new CalendarSessionSelector({
    byDay: true,
    get day() { return dayData?.start ?? requestedDay; },
    selectDay,
  });
  setupGraphCalendar(calendar, () => selectDay(Date.now()), () => { void loadCalendarSessions(); });
  musicOption.checked = false;
  music.volume = .32;

  function visitLabel({ ship, dock }: Arrival): string {
    return `${ship.name} · ${dock.name}`;
  }

  function draw(): void {
    const animate = !reducedMotion.matches;
    const { fleet, trails, current: shown, underway } = replayAt(replay, elapsed, animate);
    chart.showFleet(fleet, trails, elapsed, animate, islandVisibilityAt(replay, elapsed, animate));
    const progress = Math.round(elapsed / 100) * 100;
    if (position.valueAsNumber !== progress) position.value = String(progress);
    // The chart clock follows the slider; each ship has its own visit clock.
    const { timeRange, duration } = replay;
    const fraction = duration ? position.valueAsNumber / duration : 0;
    const timestamp = timeRange && timeRange.start + (timeRange.end - timeRange.start) * fraction;
    const day = dayData?.start ?? requestedDay;
    light.show(timestamp ?? (day === undefined ? Date.now() : new Date(day).setHours(12, 0, 0, 0)));
    if (describedUnderway !== underway) {
      describedUnderway = underway;
      underwayLabel.hidden = underway < 2;
      underwayLabel.textContent = underway >= 2 ? _('ocean_underway', '{0} 艘船同时航行', underway) : '';
    }
    const index = shown?.index ?? -1;
    const second = timestamp === undefined ? -1 : Math.floor(timestamp / 1000);
    if (index === describedIndex && second === describedSecond) return;
    if (second !== describedSecond) {
      describedSecond = second;
      time.textContent = timestamp === undefined ? '–' : timeFormat.format(timestamp);
      time.dateTime = timestamp === undefined ? '' : new Date(second * 1000).toISOString();
    }
    if (index !== describedIndex) {
      describedIndex = index;
      let place = shown?.island.site;
      if (shown?.previous && shown.previous.island !== shown.island) {
        place = `${shown.previous.island.site} → ${shown.island.site}`;
      } else if (shown?.previous) {
        place = `${place} · ${shown.previous.dock.name} → ${shown.dock.name}`;
      }
      current.textContent = shown ? `${shown.ship.name} · ${place}` : '';
    }
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
    playLabel.textContent = playing ? _('ocean_pause', '暂停') : _('ocean_play', '播放');
    syncMusic(playing);
  }

  function pause(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    setPlaying(false);
    if (refreshPending) scheduleRefresh();
  }

  function seek(time: number): void {
    pause();
    elapsed = time;
    draw();
  }

  function tick(now: number): void {
    if (previousFrame) {
      const step = Math.min(now - previousFrame, replay.duration - elapsed);
      elapsed += step;
      if (!reducedMotion.matches) {
        surfaceX = wrapSurface(surfaceX + surfaceVelocityX * step, tileSize);
        surfaceY = wrapSurface(surfaceY + surfaceVelocityY * step, tileSize);
        surface.style.transform = `translate3d(${surfaceX}px, ${surfaceY}px, 0)`;
      }
    }
    previousFrame = now;
    draw();
    if (elapsed === replay.duration) pause();
    else frame = requestAnimationFrame(tick);
  }

  function showTimeline(arrivals: Arrival[], startAt?: number): void {
    replay = prepareReplay(arrivals);
    describedIndex = -2;
    position.max = String(replay.duration);
    position.disabled = play.disabled = arrivals.length < 2;
    map.classList.toggle('can-play', !play.disabled);
    const { timeRange } = replay;
    firstTime.textContent = timeRange ? timeFormat.format(timeRange.start) : '';
    lastTime.textContent = timeRange ? timeFormat.format(timeRange.end) : '';
    seek(startAt === undefined ? replay.duration : Math.min(startAt, replay.duration));
  }

  function closePort(restoreFocus = false): void {
    port.hidden = true;
    chart.selectShip();
    chart.selectIsland();
    if (restoreFocus) {
      const shipButton = chart.shipButton(selectedVisit?.ship);
      if (shipButton) shipButton.focus();
      else if (portIsland) chart.focusIsland(portIsland);
    }
    portIsland = undefined;
    selectedVisit = undefined;
    visitDetails.replaceChildren();
  }

  function openPort(island: Island): void {
    showPort(island);
    closePortButton.focus();
  }

  function showPort(island: Island, focusedArrival?: string): void {
    selectedVisit = undefined;
    chart.selectShip();
    positionVisitPanel();
    visitDetails.replaceChildren();
    portIsland = island;
    chart.selectIsland(island);
    portName.textContent = island.site;
    document.getElementById('ocean-port-count')!.textContent =
      _('ocean_port_counts', '{0} 条记录 · {1} 个码头', island.records.toLocaleString(), island.docks.length.toLocaleString());
    const active = document.activeElement as HTMLButtonElement | null;
    if (active && portVisits.contains(active)) focusedArrival ??= active.dataset.arrival;
    const fragment = document.createDocumentFragment();
    let focus: HTMLButtonElement | undefined;
    for (const arrival of island.arrivals) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.arrival = arrival.nodeId;
      if (button.dataset.arrival === focusedArrival) focus = button;
      button.textContent = `${timeFormat.format(arrival.timestamp)} · ${visitLabel(arrival)}`;
      item.append(button);
      fragment.append(item);
    }
    portVisits.replaceChildren(fragment);
    visit.hidden = backButton.hidden = true;
    portList.hidden = false;
    port.hidden = false;
    if (focusedArrival !== undefined) (focus ?? closePortButton).focus();
  }

  function positionVisitPanel(ship?: Ship): void {
    const button = chart.shipButton(ship);
    if (!button) {
      port.classList.remove('below-ship');
      port.style.removeProperty('max-height');
      return;
    }
    const hull = button.getBoundingClientRect();
    const clock = button.querySelector('.ocean-ship-clock')!.getBoundingClientRect();
    const bounds = map.getBoundingClientRect();
    const above = Math.min(hull.top, clock.top) - bounds.top;
    const below = bounds.bottom - Math.max(hull.bottom, clock.bottom);
    port.classList.toggle('below-ship', below > above);
    // Leave room for the panel inset and the selected ship's outline.
    port.style.maxHeight = `${Math.floor(Math.max(above, below)) - 24}px`;
  }

  async function openVisit(arrival: Arrival, fromShip = false): Promise<void> {
    if (frame !== undefined) pause();
    const selection = { nodeId: arrival.nodeId, ship: fromShip ? arrival.ship : undefined };
    selectedVisit = selection;
    portIsland = arrival.island;
    chart.selectIsland(arrival.island);
    chart.selectShip(selection.ship);
    positionVisitPanel(selection.ship);
    portName.textContent = arrival.island.site;
    visitLocation.textContent = visitLabel(arrival);
    portList.hidden = true;
    visitDetails.replaceChildren();
    visitStatus.textContent = _('content_loading', '正在加载数据...');
    port.hidden = visit.hidden = backButton.hidden = false;
    port.scrollTop = 0;
    backButton.focus();

    const result = await sendToBackground('getTreeNodes', { ids: [selection.nodeId] }).catch(error => {
      console.error('Unable to read visit details', error);
    });
    if (selection !== selectedVisit) return;
    const node = result?.nodes[0];
    if (node) {
      visitStatus.textContent = '';
      visitDetails.replaceChildren(renderNodeDetails(node, isTrackingUrl(node.url)));
    } else {
      visitStatus.textContent = _('ocean_visit_unavailable', '这条访问记录已不可用。');
    }
  }

  function applySession(preserve = false): void {
    if (!dayData) return;
    const session = sessionPicker.value;
    const savedPosition = preserve && elapsed < replay.duration ? elapsed : undefined;
    const openSite = preserve ? portIsland?.site : undefined;
    history = chartHistory(session ? dayData.nodes.filter(node => node.sessionId === session) : dayData.nodes);
    chart.setHistory(history.islands);
    counts.textContent = _('ocean_counts', '{0} 座岛 · {1} 艘船 · 跨岛 {2} 段 · 沿岸 {3} 段',
      history.islands.length.toLocaleString(), history.ships.length.toLocaleString(),
      history.voyages.toLocaleString(), history.coastalTrips.toLocaleString());
    updateViewLinks(dayData.start, session);
    showTimeline(history.arrivals, savedPosition);
    const stillOpen = openSite && history.islands.find(island => island.site === openSite);
    if (stillOpen) {
      const selection = selectedVisit;
      const arrival = selection && stillOpen.arrivals.find(entry => entry.nodeId === selection.nodeId);
      if (selection && arrival) {
        if (selection.ship) selection.ship = arrival.ship;
        portIsland = stillOpen;
        chart.selectIsland(stillOpen);
        chart.selectShip(selection.ship);
        positionVisitPanel(selection.ship);
        visitLocation.textContent = visitLabel(arrival);
      } else showPort(stillOpen, selection?.nodeId);
    }
    else if (portIsland) closePort();
  }

  function updateViewLinks(day?: number, session?: string): void {
    treeView.href = graphViewUrl('tree', day).href;
    waterfallView.href = graphViewUrl('waterfall', day, session || (day === initialDay ? initialSession : undefined)).href;
  }

  function selectDay(timestamp: number): void {
    const [day] = localDayRange(timestamp);
    replaceHistorySelection(day, day === initialDay ? initialSession : undefined);
    void load(day);
  }

  async function loadCalendarSessions(): Promise<void> {
    try {
      const { sessions } = await sendToBackground('getSessions', { options: { sortBy: 'startTime', sortOrder: 'desc', limit: 500 } });
      calendarSessions = sessions;
      calendar.update(calendarSessions, undefined, calendarSessions[0]?.id);
    } catch (error) {
      console.error('Unable to load dates with sessions', error);
    }
  }

  async function load(day?: number): Promise<void> {
    const token = ++request;
    requestedDay = day;
    updateViewLinks(day);
    if (day !== undefined) dateLabel.textContent = graphDateFormat.format(day);
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
    showDay(response);
    if (refreshPending) scheduleRefresh();
  }

  function showDay(response: BackgroundResponses.GetOceanDayResponse): void {
    const previous = dayData;
    const sameDay = previous?.start === response.start;
    const selectedSession = sameDay ? sessionPicker.value : '';
    dayData = response;
    if (!sameDay) {
      dateLabel.textContent = graphDateFormat.format(response.start);
      calendar.update(calendarSessions, undefined, calendarSessions[0]?.id);
    }
    today.hidden = response.start === localDayRange(Date.now())[0];
    duration.textContent = response.nodes.length
      ? _('content_session_duration_label', '时长: {0}', formatGraphDuration(response.nodes[0].timestamp - response.nodes.at(-1)!.timestamp))
      : '';
    response.sessions.sort((a, b) => a.firstVisit - b.firstVisit);
    const sameSessions = sameDay && response.sessions.length === previous.sessions.length && response.sessions.every((session, index) => {
      const old = previous.sessions[index];
      return session.id === old.id && session.title === old.title && session.firstVisit === old.firstVisit;
    });
    if (!sameSessions) {
      const options = response.sessions.map(session => {
        const firstVisit = timeFormat.format(session.firstVisit);
        return new Option(session.title ? `${firstVisit} · ${session.title}` : firstVisit, session.id);
      });
      sessionPicker.replaceChildren(new Option(_('ocean_all_sessions', '全部会话'), ''), ...options);
      if (options.some(option => option.value === selectedSession)) sessionPicker.value = selectedSession;
      sessionPicker.disabled = !response.sessions.length;
    }
    const sameSelection = sameDay && selectedSession === sessionPicker.value;
    const sameNodes = sameDay && response.nodes.length === previous.nodes.length && response.nodes.every((node, index) => {
      const old = previous.nodes[index];
      return node.id === old.id && node.timestamp === old.timestamp && node.tabId === old.tabId && node.sessionId === old.sessionId
        && node.site === old.site && node.page === old.page;
    });
    if (!sameSelection || !sameNodes) applySession(sameSelection);
    status.hidden = Boolean(history.arrivals.length) && !response.truncated;
    status.classList.toggle('limit', response.truncated);
    status.textContent = response.truncated
      ? _('ocean_day_limit', '显示最近 {0} 条导航记录。', OCEAN_DAY_LIMIT.toLocaleString())
      : _('ocean_empty', '这一天还没有浏览记录。');
  }

  function scheduleRefresh(): void {
    refreshPending = true;
    if (refreshTimer !== undefined || refreshing || !dayData || document.hidden || frame !== undefined) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, 150);
  }

  async function refresh(): Promise<void> {
    if (!dayData || document.hidden || frame !== undefined) return;
    const token = request;
    refreshPending = false;
    refreshing = true;
    try {
      const response = await sendToBackground('getOceanDay', { date: requestedDay });
      if (token !== request) return;
      if (document.hidden || frame !== undefined) refreshPending = true;
      else showDay(response);
    } catch (error) {
      if (token === request) console.error('Unable to refresh sea chart history', error);
    } finally {
      refreshing = false;
      if (refreshPending) scheduleRefresh();
    }
  }

  function togglePlayback(): void {
    if (play.disabled) return;
    if (frame !== undefined) {
      pause();
      return;
    }
    if (elapsed === replay.duration) seek(0);
    previousFrame = 0;
    setPlaying(true);
    frame = requestAnimationFrame(tick);
  }

  play.addEventListener('click', togglePlayback);
  const image = document.querySelector<HTMLCanvasElement>('#ocean-image')!;
  image.addEventListener('contextmenu', () => {
    paintOceanImage(image, map, art, tileSize, surfaceX, surfaceY);
  });
  image.hidden = false;
  map.addEventListener('click', event => {
    if (event.target === map || event.target === image) togglePlayback();
  });
  position.addEventListener('input', () => seek(position.valueAsNumber));
  musicOption.addEventListener('change', () => syncMusic(frame !== undefined));
  music.addEventListener('loadedmetadata', positionMusic);
  sessionPicker.addEventListener('change', () => {
    applySession();
  });
  closePortButton.addEventListener('click', () => closePort(true));
  backButton.addEventListener('click', () => {
    if (portIsland) showPort(portIsland, selectedVisit?.nodeId);
  });
  port.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePort(true);
  });
  portVisits.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    const arrival = button && portIsland?.arrivals.find(entry => entry.nodeId === button.dataset.arrival);
    if (!arrival) return;
    seek(replay.arrivalsAt.get(arrival)!);
    void openVisit(arrival);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (dayData) scheduleRefresh();
    else void load(requestedDay);
  });
  window.addEventListener('focus', scheduleRefresh);
  chrome.runtime.onMessage.addListener(message => {
    if (message?.target === 'content' && message.action === 'refreshVisualization') scheduleRefresh();
  });
  reducedMotion.addEventListener('change', draw);
  await load(initialDay);
}

void initialize();
