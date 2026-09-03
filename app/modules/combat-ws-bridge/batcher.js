export class CombatBatcher {
  constructor({ flushIntervalMs = 250, maxEvents = 64, onFlush }) {
    this.flushIntervalMs = Math.max(1, Number(flushIntervalMs) || 250);
    this.maxEvents = Math.max(1, Number(maxEvents) || 64);
    this.onFlush = onFlush;
    this.matchId = null;
    this.events = [];
    this.timer = null;
  }

  push(matchId, event) {
    if (this.matchId && this.matchId !== matchId) this.flush();
    this.matchId = matchId;
    this.events.push(event);
    if (this.events.length >= this.maxEvents) return this.flush();
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    return null;
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.events.length || !this.matchId) return null;
    const batch = { matchId: this.matchId, events: this.events };
    this.matchId = null;
    this.events = [];
    return this.onFlush?.(batch) ?? batch;
  }

  stop() {
    return this.flush();
  }
}
