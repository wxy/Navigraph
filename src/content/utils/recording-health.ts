import { _ } from '../../lib/utils/i18n.js';
import type { BackgroundResponses } from '../../types/messages/background.js';

/** Pushes are hints only; status always comes from the privileged background read. */
export function setupRecordingHealth(): void {
  const status = document.createElement('div');
  status.id = 'recording-health';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  Object.assign(status.style, {
    position: 'fixed', bottom: '38px', left: '12px', right: '12px', zIndex: '1000',
    padding: '8px 12px', borderRadius: '6px', fontSize: '13px', pointerEvents: 'none'
  });
  status.hidden = true;
  document.body.appendChild(status);
  let generation = 0;
  const refresh = () => {
    const current = ++generation;
    void Promise.resolve().then(() => chrome.runtime.sendMessage({ target: 'background', action: 'getRecordingHealth', requestId: `health-${current}` }))
      .then((response: BackgroundResponses.GetRecordingHealthResponse) => {
        if (current !== generation || !response?.success || !response.health) return;
        const phase = response.health.phase;
        status.dataset.phase = phase;
        status.hidden = phase === 'healthy';
        status.style.background = phase === 'error' ? '#fee4e2' : '#fef0c7';
        status.style.color = '#7a271a';
        status.textContent = phase === 'error'
          ? _('recording_health_error', '记录异常：部分浏览记录可能未保存。')
          : phase === 'recovered'
            ? _('recording_health_recovered', '后续记录已保存；此前可能漏记的记录不会自动补回。')
            : _('recording_health_unknown', '暂时无法确认记录状态。');
      }).catch(() => {});
  };
  const listener = (message: { target?: string; action?: string }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && message?.target === 'content' && message.action === 'recordingHealthChanged') refresh();
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('pagehide', () => { ++generation; chrome.runtime.onMessage.removeListener(listener); }, { once: true });
  refresh();
}
