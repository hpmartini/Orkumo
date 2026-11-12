/**
 * Client polls that cost nothing while nobody looks: every request here makes the server start
 * processes (claude, git, gh, lsof), so a hidden tab or minimized window must not keep asking.
 */

/**
 * Calls `fn` every `ms` while the page is visible. While hidden (another tab, minimized window)
 * nothing runs; on return `fn` runs at once and the interval starts over.
 * `immediate`: run right away when started on a visible page (else first after `ms`).
 * @returns stop
 */
export function pollWhileVisible(
  fn: () => void,
  ms: number,
  { immediate = true }: { immediate?: boolean } = {}
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const pause = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const resume = () => {
    if (!timer) timer = setInterval(fn, ms);
  };
  const onVisibility = () => {
    if (document.hidden) pause();
    else if (!timer) {
      fn();
      resume();
    }
  };
  if (!document.hidden) {
    if (immediate) fn();
    resume();
  }
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    pause();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export interface Throttle {
  call(): void;
  /** Drop a pending run */
  cancel(): void;
}

/**
 * Runs `fn` at most once per `ms`: the first call runs at once, calls within the gap collapse
 * into one run when it ends.
 */
export function createThrottle(fn: () => void, ms: number): Throttle {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    last = Date.now();
    fn();
  };
  return {
    call() {
      if (timer) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
