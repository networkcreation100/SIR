import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

let mockPlugin;
vi.mock('@capacitor/local-notifications', () => ({
  get LocalNotifications() { return mockPlugin; },
}));

function futureDateParts(offsetMs = 60 * 60 * 1000) {
  const d = new Date(Date.now() + offsetMs);
  return {
    date: d.toISOString().slice(0, 10),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

describe('native notification scheduling', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPlugin = {
      checkPermissions: vi.fn(async () => ({ display: 'granted' })),
      requestPermissions: vi.fn(async () => ({ display: 'granted' })),
      cancel: vi.fn(async () => {}),
      schedule: vi.fn(() => new Promise(() => {})), // native bridge hangs
      getPending: vi.fn(async () => ({ notifications: [] })),
      setBadge: vi.fn(async () => {}),
    };
  });

  it('returns instead of hanging when native schedule never resolves', async () => {
    const { scheduleReminderNotification } = await import('./nativeNotify.js');
    const { date, time } = futureDateParts();
    const started = Date.now();
    const result = await scheduleReminderNotification({ id: 'freeze-regression', title: 'Test', date, time });
    const elapsed = Date.now() - started;

    expect(result.scheduled).toBe(false);
    expect(result.reason).toBe('schedule-timeout');
    expect(elapsed).toBeLessThan(2200);
    expect(mockPlugin.schedule).toHaveBeenCalledTimes(1);
  });
});
