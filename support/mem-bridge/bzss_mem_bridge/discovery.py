"""Budgeted, resumable discovery of map point actors.

The scanner never publishes a partially discovered replacement set. The caller
continues to serve the last completed set until a new scan finishes.
"""
import time

from .memory import BridgeError


class IncrementalPointDiscovery:
    def __init__(self):
        self.reset()

    def reset(self):
        self.active = False
        self.levels = ()
        self.level_index = 0
        self.current_level_info = None
        self.actors = ()
        self.actor_index = 0
        self.rows = []
        self.seen = set()
        self.actor_total = 0
        self.actor_inspected = 0
        self.skipped = 0
        self.started_at = 0.0

    def begin(self, levels):
        self.reset()
        self.levels = tuple(levels)
        self.started_at = time.monotonic()
        self.active = True

    def stats(self):
        return {
            'actorsScanned': self.actor_inspected,
            'actorsEnumerated': self.actor_total,
            'skippedActors': self.skipped,
            'discoveryDurationMs': round((time.monotonic() - self.started_at) * 1000, 2),
        }

    def progress(self):
        return {
            'active': self.active,
            'levelsProcessed': self.level_index,
            'levelCount': len(self.levels),
            'actorsProcessed': self.actor_inspected,
            'actorsEnumerated': self.actor_total,
        }

    def step(self, ue, layout, classify, allowed, levels, max_actors=1024, time_budget_ms=10.0):
        """Scan at most max_actors and roughly time_budget_ms of work.

        Returns (point_entries, stats) only on completion; otherwise None.
        A changed level list invalidates the in-flight scan without replacing
        the last successfully published list of points.
        """
        if not self.active:
            return None
        if tuple(levels) != self.levels:
            self.reset()
            return None

        max_actors = max(1, min(int(max_actors), 5000))
        time_budget_ms = max(1.0, min(float(time_budget_ms), 30.0))
        deadline = time.monotonic() + time_budget_ms / 1000.0
        consumed = 0
        offset = int(layout['levelActorsOffset'], 0)

        while self.level_index < len(self.levels):
            level = self.levels[self.level_index]
            if self.current_level_info is None:
                info = ue.info(level)
                if not ue.is_a(level, 'Level'):
                    self.level_index += 1
                    continue
                self.actors = ue.array_at(level, offset, 50000)
                self.actor_total += len(self.actors)
                if self.actor_total > 150000:
                    raise BridgeError('actor_limit', 'Current world exceeds actor discovery limit.')
                self.current_level_info = info
                self.actor_index = 0

            if not ue.unchanged(self.current_level_info):
                raise BridgeError('world_changed', 'Level changed during incremental discovery.')

            while self.actor_index < len(self.actors):
                actor = self.actors[self.actor_index]
                self.actor_index += 1
                consumed += 1
                self.actor_inspected += 1

                if actor and actor not in self.seen:
                    self.seen.add(actor)
                    try:
                        info = ue.info(actor)
                        if info.outer == level:
                            kind = classify(actor)
                            if kind in allowed:
                                self.rows.append((info, self.current_level_info, kind))
                    except BridgeError:
                        self.skipped += 1

                if consumed >= max_actors or time.monotonic() >= deadline:
                    return None

            if not ue.unchanged(self.current_level_info):
                raise BridgeError('world_changed', 'Level changed during incremental discovery.')
            self.current_level_info = None
            self.actors = ()
            self.actor_index = 0
            self.level_index += 1

            if time.monotonic() >= deadline:
                return None

        result = (self.rows, self.stats())
        self.reset()
        return result
