import type { BackgroundMessages, BackgroundResponses } from '../../types/messages/background.js';
import type { GraphPageQuery } from '../../lib/graph/query.js';
import type { Session, SessionDetails } from '../types/session.js';
import type { SessionMetadata, GraphFilters, GraphPageInfo } from '../../lib/graph/query.js';
import { DEFAULT_GRAPH_FILTERS } from '../../lib/graph/query.js';
import { nodeManager } from './node-manager.js';
import { sendMessage } from '../messaging/content-message-service.js';

async function requestGraphPage(query: GraphPageQuery): Promise<BackgroundResponses.GetSessionPageResponse> {
  const request: Omit<BackgroundMessages.GetSessionPageRequest, 'requestId'> = { ...query, action: 'getSessionPage', target: 'background' };
  return sendMessage(request.action, query);
}

type SessionEventCallback = (session: SessionDetails | null) => void;
/** Owns one bounded page. A new query invalidates every earlier response before any state is applied. */
export class SessionServiceClient {
  private static instance: SessionServiceClient | null = null;
  private sessionList: SessionMetadata[] = [];
  private currentSession: SessionDetails | null = null;
  private currentSessionId: string | null = localStorage.getItem('navigraph_current_session');
  private latestSession: SessionMetadata | null = null;
  private generation = 0;
  private pendingListRequest: Promise<SessionMetadata[]> | null = null;
  private sessionLoadListeners: SessionEventCallback[] = [];
  private sessionsListLoadedListeners: ((sessions: Session[]) => void)[] = [];
  private latestSessionLoadListeners: ((session: SessionMetadata | null) => void)[] = [];
  private readFilters: () => GraphFilters = () => DEFAULT_GRAPH_FILTERS;
  private readLimit: () => number = () => 100;
  private requestedPage = 0;
  private requestedEdgePage = 0;
  public pageInfo: GraphPageInfo | null = null;

  public static getInstance(): SessionServiceClient {
    return this.instance || (this.instance = new SessionServiceClient());
  }
  configure(filters: () => GraphFilters, limit: () => number): void { this.readFilters = filters; this.readLimit = limit; }
  onSessionLoaded(callback: SessionEventCallback): void { this.sessionLoadListeners.push(callback); }
  onSessionsListLoaded(callback: (sessions: Session[]) => void): void { this.sessionsListLoadedListeners.push(callback); }
  onLatestSessionLoaded(callback: (session: SessionMetadata | null) => void): void { this.latestSessionLoadListeners.push(callback); }

  async loadSessionList(): Promise<SessionMetadata[]> {
    if (this.pendingListRequest) return this.pendingListRequest;
    this.pendingListRequest = (async () => {
      const response = await sendMessage('getSessions');
      if (!response?.success) throw new Error(response?.error || 'Session list unavailable');
      this.sessionList = response.sessions;
      for (const listener of this.sessionsListLoadedListeners) listener(this.sessionList);
      return this.sessionList;
    })();
    try { return await this.pendingListRequest; } finally { this.pendingListRequest = null; }
  }

  async loadSession(sessionId: string): Promise<SessionDetails | null> {
    if (sessionId !== this.currentSessionId) { this.requestedPage = 0; this.requestedEdgePage = 0; }
    this.setCurrentSessionId(sessionId);
    return this.loadPage();
  }

  async loadPage(page = this.requestedPage, edgePage = this.requestedEdgePage): Promise<SessionDetails | null> {
    const sessionId = this.currentSessionId;
    if (!sessionId) return null;
    if (page !== this.requestedPage) edgePage = 0;
    this.requestedPage = page; this.requestedEdgePage = edgePage;
    const generation = ++this.generation;
    const query = { sessionId, page, edgePage, limit: Math.max(1, Math.min(500, Math.floor(this.readLimit()))), filters: { ...this.readFilters() } };
    const queryKey = JSON.stringify(query);
    try {
      const response = await requestGraphPage(query);
      if (generation !== this.generation || queryKey !== JSON.stringify({ ...query, sessionId: this.currentSessionId })) return this.currentSession;
      if (!response.success) throw new Error(response.error || 'Page unavailable');
      if (!response.session) {
        // Deleted session: clear this page immediately, then choose a valid metadata entry.
        this.currentSession = null; this.pageInfo = null; nodeManager.processPageData([], []);
        for (const listener of this.sessionLoadListeners) listener(null);
        await this.loadSessionList();
        if (generation !== this.generation) return this.currentSession;
        this.setCurrentSessionId(null);
        return this.loadCurrentSession();
      }
      this.pageInfo = response.pageInfo;
      this.requestedPage = response.pageInfo.page; this.requestedEdgePage = response.pageInfo.edgePage;
      this.currentSession = { ...response.session };
      nodeManager.processPageData(response.nodes, response.edges);
      for (const listener of this.sessionLoadListeners) listener(this.currentSession);
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
    if (this.currentSessionId && this.sessionList.some(session => session.id === this.currentSessionId)) return this.loadPage();
    const generation = ++this.generation;
    const latest = await this.loadLatestSession();
    if (generation !== this.generation) return this.currentSession;
    const id = latest?.id || this.sessionList[0]?.id;
    if (id) return this.loadSession(id);
    this.setCurrentSessionId(null); this.currentSession = null; this.pageInfo = null;
    nodeManager.processPageData([], []);
    for (const listener of this.sessionLoadListeners) listener(null);
    return null;
  }
  async switchSession(sessionId: string): Promise<SessionDetails | null> { return this.loadSession(sessionId); }
  setCurrentSessionId(sessionId: string | null): void {
    if (sessionId !== this.currentSessionId) { this.generation++; this.requestedPage = 0; this.requestedEdgePage = 0; }
    this.currentSessionId = sessionId;
    if (sessionId) localStorage.setItem('navigraph_current_session', sessionId);
    else localStorage.removeItem('navigraph_current_session');
  }
  getSessionList(): SessionMetadata[] { return this.sessionList; }
  getCurrentSession(): SessionDetails | null { return this.currentSession; }
  getCurrentSessionId(): string | null { return this.currentSessionId; }
}
export const sessionServiceClient = SessionServiceClient.getInstance();
