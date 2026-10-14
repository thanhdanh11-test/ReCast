/** Next timeline position for one playback tick: rate-scaled, looping or stopping at the end. */
export function advancePlayback(t: number, dt: number, rate: number, end: number, loop: boolean): { time: number; done: boolean } {
    const next = t + dt * rate;
    if (next < end) return { time: next, done: false };
    return loop && end > 0 ? { time: 0, done: false } : { time: end, done: true };
}
