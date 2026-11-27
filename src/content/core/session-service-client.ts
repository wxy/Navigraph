import type { Session, SessionDetails } from '../types/session.js';
import type { SessionMetadata, GraphFilters } from '../../lib/graph/query.js';
import type { WaterfallTimeline } from '../../lib/graph/waterfall.js';
import { DEFAULT_GRAPH_FILTERS } from '../../lib/graph/query.js';
import { sendMessage } from '../messaging/content-message-service.js';

type SessionEventCallback = (session: SessionDetails | null, fitToView?: boolean) => void;
/** Owns the selected session's bounded timeline. A new query invalidates earlier responses. */
export class SessionServiceClient {
  private static instance: SessionServiceClient | null = null;
  private sessionList: SessionMetadata[] = [];
  private currentSession: SessionDetails | null = null;
  private currentSessionId: string | null = null;
  private followsLatestSession = true;
  private latestSession: SessionMetadata | null = null;
  private generation = 0;
  private pendingListRequest: Promise<SessionMetadata[]> | null = null;
  private sessionLoadListeners: SessionEventCallback[] = [];
  private sessionsListLoadedListeners: ((sessions: Session[]) => void)[] = [];
  private latestSessionLoadListeners: ((session: SessionMetadata | null) => void)[] = [];
  private readFilters: () => GraphFilters = () => DEFAULT_GRAPH_FILTERS;
  private appliedFilters?: string;
  public timeline: WaterfallTimeline | null = null;

  public static getInstance(): SessionServiceClient {
    return this.instance || (this.instance = new SessionServiceClient());
  }
  configure(filters: () => GraphFilters): void { this.readFilters = filters; }
  onSessionLoaded(callback: SessionEventCallback): void { this.sessionLoadListeners.push(callback); }
  onSessionsListLoaded(callback: (sessions: Session[]) => void): void { this.sessionsListLoadedListeners.push(callback); }
  onLatestSessionLoaded(callback: (session: SessionMetadata | null) => void): void { this.latestSessionLoadListeners.push(callback); }

  async loadSessionList(): Promise<SessionMetadata[]> {
    if (this.pendingListRequest) return this.pendingListRequest;
    this.pendingListRequest = (async () => {
      const response = await sendMessage('getSessions', {
        options: { sortBy: 'startTime', sortOrder: 'desc' },
      });
      if (!response?.success) throw new Error(response?.error || 'Session list unavailable');
      this.sessionList = response.sessions;
      for (const listener of this.sessionsListLoadedListeners) listener(this.sessionList);
      return this.sessionList;
    })();
    try { return await this.pendingListRequest; } finally { this.pendingListRequest = null; }
  }

  private async loadSession(sessionId: string): Promise<SessionDetails | null> {
    this.setCurrentSessionId(sessionId);
    return this.loadTimeline();
  }

  async loadTimeline(): Promise<SessionDetails | null> {
    const sessionId = this.currentSessionId;
    if (!sessionId) return null;
    const generation = ++this.generation;
    const filters = { ...this.readFilters() };
    try {
      const response = await sendMessage('getWaterfallTimeline', { sessionId, filters });
      if (generation !== this.generation) return this.currentSession;
      if (!response.success) throw new Error(response.error || 'Timeline unavailable');
      if (!response.session) {
        this.currentSession = null;
        this.timeline = null;
        for (const listener of this.sessionLoadListeners) listener(null);
        await this.loadSessionList();
        if (generation !== this.generation) return this.currentSession;
        this.setCurrentSessionId(null);
        return this.loadCurrentSession();
      }
      const filterKey = JSON.stringify(filters);
      const fitToView = this.currentSession?.id === sessionId && this.appliedFilters !== filterKey;
      this.appliedFilters = filterKey;
      this.timeline = response;
      this.currentSession = { ...response.session };
      for (const listener of this.sessionLoadListeners) listener(this.currentSession, fitToView);
      return this.currentSession;
    } catch (error) {
      if (generation !== this.generation) return this.currentSession;
      throw error;
    }
  }

  async loadLatestSession(): Promise<SessionMetadata | null> {
    const response = await sendMessage('getLatestSession');
    if (!response?.success) throw new Error(response?.error || 'Latest session unavailable');
    this.latestSession = response.session || null;
    for (const listener of this.latestSessionLoadListeners) listener(this.latestSession);
    return this.latestSession;
  }
  getLatestSessionId(): string | null { return this.latestSession?.id || null; }
  getLatestSession(): SessionMetadata | null { return this.latestSession; }

  async loadCurrentSession(): Promise<SessionDetails | null> {
    const generation = ++this.generation;
    const latest = await this.loadLatestSession();
    if (generation !== this.generation) return this.currentSession;
    if (!this.followsLatestSession && this.sessionList.some(session => session.id === this.currentSessionId)) {
      return this.loadTimeline();
    }
    this.followsLatestSession = true;
    const latestWithRecords = latest?.nodeCount
      ? latest
      : this.sessionList.find(session => (session.nodeCount ?? 0) > 0);
    const session = latestWithRecords ?? latest ?? this.sessionList[0];
    if (session) return this.loadSession(session.id);
    this.setCurrentSessionId(null); this.currentSession = null; this.timeline = null;
    for (const listener of this.sessionLoadListeners) listener(null);
    return null;
  }
  async switchSession(sessionId: string): Promise<SessionDetails | null> {
    this.followsLatestSession = false;
    return this.loadSession(sessionId);
  }
  private setCurrentSessionId(sessionId: string | null): void {
    if (sessionId !== this.currentSessionId) this.generation++;
    this.currentSessionId = sessionId;
  }
  getSessionList(): SessionMetadata[] { return this.sessionList; }
  getCurrentSession(): SessionDetails | null { return this.currentSession; }
  getCurrentSessionId(): string | null { return this.currentSessionId; }
}
export const sessionServiceClient = SessionServiceClient.getInstance();
