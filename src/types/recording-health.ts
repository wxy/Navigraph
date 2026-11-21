/** Bounded recording status. Never contains page data or platform error messages. */
export interface RecordingHealth {
  phase: 'unknown' | 'healthy' | 'error' | 'recovered';
  failedAt?: number;
  recoveredAt?: number;
}
