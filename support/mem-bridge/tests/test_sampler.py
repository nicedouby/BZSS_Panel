"""Sampler transaction tests; they do not attach to a live process."""
import unittest

from bzss_mem_bridge.memory import BridgeError
from bzss_mem_bridge.server import Sampler


def snapshot():
    return {
        'schema': 1,
        'module': 'BZSS-MEM-BRIDGE',
        'version': 'test',
        'readOnly': True,
        'target': 'formal',
        'observedAt': 100.0,
        'epoch': 'same-world',
        'players': [{'id': 'player-1'}],
        'mapPoints': [{'id': 'point-1'}],
        'health': {'status': 'ok', 'readCalls': 5},
    }


class FakeReader:
    def __init__(self, responses):
        self.responses = iter(responses)

    def snapshot(self):
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response


class SamplerTests(unittest.TestCase):
    def make_sampler(self, responses):
        sampler = Sampler({'id': 'formal'}, {}, interval=.5, max_age=4)
        sampler.reader = FakeReader(responses)
        return sampler

    def test_transient_failure_retains_bounded_cache_with_explicit_degraded_status(self):
        sampler = self.make_sampler([
            snapshot(),
            BridgeError('read_budget', 'Over budget'),
        ])
        self.assertEqual(sampler.sample_once(), 'ok')
        self.assertEqual(sampler.sample_once(), 'read_budget')
        last = sampler.latest()
        self.assertEqual(last['health']['status'], 'degraded')
        self.assertEqual(last['health']['code'], 'read_budget')
        self.assertEqual(last['players'], [{'id': 'player-1'}])
        self.assertEqual(last['epoch'], 'same-world')

    def test_world_change_never_exposes_cache_from_previous_epoch(self):
        sampler = self.make_sampler([
            snapshot(),
            BridgeError('world_changed', 'Different world'),
        ])
        sampler.sample_once()
        sampler.sample_once()
        last = sampler.latest()
        self.assertEqual(last['health']['status'], 'unavailable')
        self.assertEqual(last['players'], [])

    def test_failed_sample_cannot_extend_old_cache_lifetime(self):
        sampler = self.make_sampler([
            snapshot(),
            BridgeError('read_budget', 'Over budget'),
        ])
        sampler.sample_once()
        sampler.last_good_at -= 100
        sampler.sample_once()
        self.assertEqual(sampler.latest()['health']['status'], 'unavailable')


if __name__ == '__main__':
    unittest.main()
