import { DEFAULT_SETTINGS } from '../../lib/settings/constants.js';
import type { ViewType } from '../../lib/settings/types.js';

type GraphView = Extract<ViewType, 'tree' | 'waterfall'>;
export function validView(value: unknown): GraphView | undefined {
  return value === 'tree' || value === 'waterfall' ? value : undefined;
}
export function defaultView(): GraphView {
  return validView(window.navigraphSettings?.defaultView) || validView(DEFAULT_SETTINGS.defaultView) || 'waterfall';
}
export function animationsEnabled(): boolean { return window.navigraphSettings?.animationEnabled !== false; }
export function animationDuration(milliseconds: number): number { return animationsEnabled() ? milliseconds : 0; }
export function labelsEnabled(): boolean { return window.navigraphSettings?.showLabels !== false; }
