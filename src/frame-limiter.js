// Fixed-rate frame scheduler. requestAnimationFrame still runs at refresh rate,
// but expensive scene updates/rendering happen only on accepted timestamps.
export const FPS_OPTIONS = Object.freeze([30,60,90,120,144,0]); // 0 = unlimited

export function createFrameLimiter() {
  let next = null, previousCap = null;
  function allow(now, cap) {
    if (!Number.isFinite(now)) return false;
    if (cap === 0) {
      next = null;previousCap = 0;
      return true;
    }
    const rate = FPS_OPTIONS.includes(cap) && cap > 0 ? cap : 60;
    const interval = 1000/rate;
    if (previousCap !== rate || next === null || now > next + 1000) {
      previousCap = rate;
      next = now + interval;
      return true;
    }
    if (now + .18 < next) return false;
    const missed = Math.max(0,Math.floor((now-next)/interval));
    next += (missed+1)*interval;
    return true;
  }
  return {allow};
}
