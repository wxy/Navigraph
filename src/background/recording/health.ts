import type { RecordingHealth } from '../../types/recording-health.js';
import { _ } from '../../lib/utils/i18n.js';

const KEY = 'recordingHealth';
class RecordingHealthService {
  private state: RecordingHealth = { phase: 'unknown' };
  private epoch = 0;
  private started = false;
  private pending?: RecordingHealth;
  private writing = false;
  private actionChannels = new Map<string, { running: boolean; pending?: () => Promise<void> }>();
  private notificationPending = false;
  private notifying = false;

  public get(): RecordingHealth { return { ...this.state }; }

  // Restore is deliberately independent of background readiness and the recording queue.
  public start(): void {
    if (this.started) return;
    this.started = true;
    const epoch = this.epoch;
    const timer = setTimeout(() => {
      if (epoch === this.epoch) this.present();
    }, 1000);
    void Promise.resolve().then(() => chrome.storage.local.get(KEY)).then(result => {
      if (epoch !== this.epoch) return;
      const saved = result[KEY];
      if (saved && ['healthy', 'error', 'recovered', 'unknown'].includes(saved.phase)) {
        this.state = { phase: saved.phase };
        for (const key of ['failedAt', 'recoveredAt'] as const) {
          if (Number.isFinite(saved[key]) && saved[key] >= 0) this.state[key] = saved[key];
        }
      } else this.state = { phase: saved === undefined ? 'healthy' : 'unknown' };
      this.present();
    }).catch(() => { if (epoch === this.epoch) this.present(); }).finally(() => clearTimeout(timer));
  }

  public failed(): void {
    ++this.epoch;
    if (this.state.phase === 'error') return;
    this.transition({ phase: 'error', failedAt: Date.now() });
  }

  public committed(): void {
    // Even an unchanged success invalidates an older asynchronous restore.
    ++this.epoch;
    if (this.state.phase === 'healthy' || this.state.phase === 'recovered') return;
    this.transition({ phase: 'recovered', failedAt: this.state.failedAt, recoveredAt: Date.now() });
  }

  private transition(state: RecordingHealth): void {
    this.state = state;
    this.pending = this.get();
    this.drain();
    this.present();
  }

  // At most one in-flight storage operation plus one latest snapshot, even if APIs hang.
  private drain(): void {
    if (this.writing || !this.pending) return;
    const state = this.pending;
    this.pending = undefined;
    this.writing = true;
    void Promise.resolve().then(() => chrome.storage.local.set({ [KEY]: state })).catch(() => {}).finally(() => {
      this.writing = false;
      this.drain();
    });
  }

  private present(): void {
    this.updateAction(this.get());
    this.notificationPending = true;
    this.drainNotification();
  }

  private drainNotification(): void {
    if (this.notifying || !this.notificationPending) return;
    this.notificationPending = false;
    this.notifying = true;
    void Promise.resolve().then(() => chrome.runtime.sendMessage({ target: 'content', action: 'recordingHealthChanged' })).catch(() => {}).finally(() => {
      this.notifying = false;
      this.drainNotification();
    });
  }

  // Each native API has its own one-in-flight/one-latest channel: a hung color
  // or title operation cannot prevent a still-working badge from warning later.
  private action(key: string, operation: () => Promise<void>): void {
    let channel = this.actionChannels.get(key);
    if (!channel) {
      channel = { running: false };
      this.actionChannels.set(key, channel);
    }
    channel.pending = operation;
    const drain = () => {
      if (channel.running || !channel.pending) return;
      const next = channel.pending;
      channel.pending = undefined;
      channel.running = true;
      void Promise.resolve().then(next).catch(() => {}).finally(() => {
        channel.running = false;
        drain();
      });
    };
    drain();
  }

  private updateAction(state: RecordingHealth): void {
    const warning = state.phase === 'error' || state.phase === 'unknown';
    const title = state.phase === 'error'
      ? _('recording_health_error', '记录异常：部分浏览记录可能未保存。')
      : state.phase === 'recovered'
        ? _('recording_health_recovered', '后续记录已保存；此前可能漏记的记录不会自动补回。')
        : state.phase === 'unknown'
          ? _('recording_health_unknown', '暂时无法确认记录状态。') : 'Navigraph';
    this.action('badge', () => chrome.action.setBadgeText({ text: warning ? '!' : '' }));
    this.action('color', () => chrome.action.setBadgeBackgroundColor({ color: '#b42318' }));
    this.action('title', () => chrome.action.setTitle({ title }));
  }
}
export const recordingHealth = new RecordingHealthService();
