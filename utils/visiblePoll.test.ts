import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createThrottle, pollWhileVisible } from './visiblePoll';

let hidden = false;
const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pollWhileVisible', () => {
  it('runs at once and every interval while visible; stop ends it', () => {
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 1000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(5000);
    setHidden(true);
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('pauses while hidden and runs once on return', () => {
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 1000);
    fn.mockClear();
    setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('started hidden: nothing until visible; immediate: false waits one interval', () => {
    hidden = true;
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 1000);
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();

    hidden = false;
    const later = vi.fn();
    const stopLater = pollWhileVisible(later, 1000, { immediate: false });
    expect(later).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(later).toHaveBeenCalledTimes(1);
    stopLater();
  });

  it('a repeated visible event does not start a second interval', () => {
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 1000);
    setHidden(false);
    setHidden(false);
    fn.mockClear();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('createThrottle', () => {
  it('first call runs at once, a burst within the gap collapses into one trailing run', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 10_000);
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    throttle.call();
    throttle.call();
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(8_000);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    expect(fn).toHaveBeenCalledTimes(2);
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('cancel drops the pending run', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 10_000);
    throttle.call();
    throttle.call();
    throttle.cancel();
    vi.advanceTimersByTime(20_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
