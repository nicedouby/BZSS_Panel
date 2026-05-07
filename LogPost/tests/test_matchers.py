import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bzss_parser.identity_cache import IdentityCache
from bzss_parser.matchers.combat_matcher import CombatMatcher
from bzss_parser.matchers.helpers import parse_online_ids
from bzss_parser.matchers.server_tick_rate_matcher import ServerTickRateMatcher


class CombatMatcherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.matcher = CombatMatcher(IdentityCache())

    def test_damaged_parses_caused_by_without_space_after_parenthesis(self) -> None:
        line = (
            "[2026.05.07-12.39.26:173][276]LogSquad: Player: 试作型岛风 ActualDamage=62.000004 "
            "from  别说你爷 (Online IDs: EOS: 000262cdb3d74f43b95da83d6640873c steam: 76561199511806113 "
            "| Player Controller ID: BP_PlayerController_C_2146301565)caused by "
            "BP_EF88_Specter_Foregrip_C_2146294694"
        )

        event_name, params = self.matcher.parse_player_damaged(line)
        data = dict(params)

        self.assertEqual(event_name, "On_PlayerDamaged")
        self.assertEqual(data["CausedBy"], "BP_EF88_Specter_Foregrip_C_2146294694")

    def test_partial_parse_does_not_stay_high_confidence(self) -> None:
        line = (
            "[2026.05.07-12.39.26:173][276]LogSquad: Player: 试作型岛风 ActualDamage=62.000004 "
            "from  别说你爷 (Online IDs: EOS: 000262cdb3d74f43b95da83d6640873c steam: 76561199511806113 | Player Controller ID: "
            "BP_PlayerController_C_2146301565)caused by BP_EF88_Specter_Foregrip_C_2146294694"
        )

        _, params = self.matcher.parse_player_damaged(line)
        data = dict(params)

        self.assertEqual(data["ParseStatus"], "Partial")
        self.assertEqual(data["ParseConfidence"], "Medium")
        self.assertNotEqual(data["Confidence"], "High")


class ServerTickRateMatcherTests(unittest.TestCase):
    def test_server_tick_rate_event_is_generated(self) -> None:
        matcher = ServerTickRateMatcher({
            "expected": 30,
            "warning_below": 28,
            "critical_below": 20,
        })

        matched = matcher.match(
            "[2026.05.07-12.54.02:963][784]LogSquad: USQGameState: Server Tick Rate: 29.20"
        )

        self.assertIsNotNone(matched)
        event_name, params = matched
        data = dict(params)

        self.assertEqual(event_name, "On_ServerTickRateUpdated")
        self.assertEqual(data["TickRate"], "29.20")
        self.assertEqual(data["Unit"], "TPS")
        self.assertEqual(data["Status"], "good")


class IdSanitizationTests(unittest.TestCase):
    def test_parse_online_ids_strips_trailing_non_digits_from_steam64(self) -> None:
        _, steam = parse_online_ids(
            "[2026.05.07-13.30.34:241][259]LogSquadTrace: [DedicatedServer]Die(): Player: A "
            "KillingDamage=-300.000000 from BP_PlayerController_C_2146370936 "
            "(Online IDs: EOS: 0002a5a45cd94723b5b0f70c8d932615 steam: 76561199134649454) "
            "| Contoller ID: BP_PlayerController_C_2146370936) caused by BP_Soldier_X"
        )

        self.assertEqual(steam, "76561199134649454")


if __name__ == "__main__":
    unittest.main()
