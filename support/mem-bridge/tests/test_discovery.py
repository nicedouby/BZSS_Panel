"""Unit tests for incremental actor discovery; no live Squad process needed."""
import unittest
from dataclasses import dataclass

from bzss_mem_bridge.discovery import IncrementalPointDiscovery
from bzss_mem_bridge.memory import BridgeError


@dataclass(frozen=True)
class FakeInfo:
    address: int
    outer: int = 0


class FakeUE:
    def __init__(self):
        self.levels = {10: [100, 101, 102, 103], 20: [200, 201]}
        self.classes = {100: 'capture_zone', 101: None, 102: 'spawn_point',
                        103: None, 200: 'main_base', 201: None}

    def info(self, address):
        return FakeInfo(address, 10 if address < 200 else 20)

    def is_a(self, obj, kind):
        return obj in self.levels and kind == 'Level'

    def array_at(self, level, _offset, _limit):
        return self.levels[level]

    def unchanged(self, _info):
        return True


class DiscoveryTests(unittest.TestCase):
    def test_resumes_without_repeating_actors_or_publishing_partial_set(self):
        ue = FakeUE()
        discovery = IncrementalPointDiscovery()
        calls = []

        def classify(actor):
            calls.append(actor)
            return ue.classes[actor]

        discovery.begin([10, 20])
        results = []
        for _ in range(10):
            result = discovery.step(
                ue, {'levelActorsOffset': '0x0'}, classify,
                {'capture_zone', 'spawn_point', 'main_base'}, [10, 20],
                max_actors=2, time_budget_ms=30,
            )
            if result is not None:
                results.append(result)
                break

        self.assertEqual(len(results), 1)
        points, stats = results[0]
        self.assertEqual({info.address for info, _, _ in points}, {100, 102, 200})
        self.assertEqual(calls, [100, 101, 102, 103, 200, 201])
        self.assertEqual(stats['actorsScanned'], 6)
        self.assertFalse(discovery.active)

    def test_level_list_change_discards_inflight_scan(self):
        ue = FakeUE()
        discovery = IncrementalPointDiscovery()
        discovery.begin([10, 20])
        self.assertIsNone(discovery.step(
            ue, {'levelActorsOffset': '0x0'}, lambda _: 'capture_zone',
            {'capture_zone'}, [10, 20], max_actors=1,
        ))
        self.assertIsNone(discovery.step(
            ue, {'levelActorsOffset': '0x0'}, lambda _: 'capture_zone',
            {'capture_zone'}, [20], max_actors=1,
        ))
        self.assertFalse(discovery.active)

    def test_progress_and_reset(self):
        ue = FakeUE()
        discovery = IncrementalPointDiscovery()
        discovery.begin([10])
        self.assertIsNone(discovery.step(
            ue, {'levelActorsOffset': '0x0'}, lambda _: None,
            set(), [10], max_actors=1,
        ))
        progress = discovery.progress()
        self.assertTrue(progress['active'])
        self.assertEqual(progress['actorsProcessed'], 1)
        discovery.reset()
        self.assertFalse(discovery.progress()['active'])


if __name__ == '__main__':
    unittest.main()
