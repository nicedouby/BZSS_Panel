import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bzss_parser.identity_cache import IdentityCache
from bzss_parser.event_builder import EventBuilder
from bzss_parser.matchers.combat_matcher import CombatMatcher
from bzss_parser.matchers.helpers import parse_online_ids
from bzss_parser.matchers.server_tick_rate_matcher import ServerTickRateMatcher
from bzss_parser.matchers.world_bring_up_matcher import WorldBringUpMatcher


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

    def test_combat_status_uses_required_fields_only(self) -> None:
        line = (
            "[2026.05.07-12.39.26:173][276]LogSquad: Player: 试作型岛风 ActualDamage=62.000004 "
            "from  别说你爷 (Online IDs: EOS: 000262cdb3d74f43b95da83d6640873c steam: 76561199511806113 | Player Controller ID: "
            "BP_PlayerController_C_2146301565)caused by BP_EF88_Specter_Foregrip_C_2146294694"
        )

        _, params = self.matcher.parse_player_damaged(line)
        data = dict(params)

        self.assertEqual(data["ParseStatus"], "Full")
        self.assertEqual(data["ParseConfidence"], "High")

    def test_damaged_accepts_non_logsquad_prefix(self) -> None:
        line = (
            "LogSquadTrace: Player: Victim ActualDamage=62.000004 from Attacker "
            "(Online IDs: EOS: xxx steam: 76561198000000000 | Player Controller ID: BP_PlayerController_C_123) "
            "caused by BP_Rifle_C"
        )

        matched = self.matcher.match(line)
        self.assertIsNotNone(matched)
        event_name, params = matched
        data = dict(params)

        self.assertEqual(event_name, "On_PlayerDamaged")
        self.assertEqual(data["VictimName"], "Victim")
        self.assertEqual(data["AttackerName"], "Attacker")
        self.assertEqual(data["ActualDamage"], "62.000004")
        self.assertEqual(data["CausedBy"], "BP_Rifle_C")

    def test_died_from_nullptr_with_invalid_ids_is_kept(self) -> None:
        line = (
            "LogSquadTrace: [DedicatedServer]Die(): Player: Braovo KillingDamage=-300.000000 "
            "from nullptr (Online IDs: INVALID | Contoller ID: None) caused by "
            "BP_Soldier_PLA_SquadLeader_Arid_C_2147373303"
        )

        matched = self.matcher.match(line)
        self.assertIsNotNone(matched)
        event_name, params = matched
        data = dict(params)

        self.assertEqual(event_name, "On_PlayerDied")
        self.assertEqual(data["VictimName"], "Braovo")
        self.assertEqual(data["KillingDamage"], "-300.000000")
        self.assertEqual(data["FromObject"], "nullptr")
        self.assertEqual(data["CausedBy"], "BP_Soldier_PLA_SquadLeader_Arid_C_2147373303")
        self.assertEqual(data["AttackerName"], "")
        self.assertEqual(data["ParseStatus"], "Full")

    def test_wounded_event_is_generated(self) -> None:
        line = (
            "Wound(): Player: Victim KillingDamage=80.000000 from Attacker "
            "(Online IDs: EOS: xxx steam: 76561198000000000 | Player Controller ID: BP_PlayerController_C_123) "
            "caused by BP_Weapon_C"
        )

        matched = self.matcher.match(line)
        self.assertIsNotNone(matched)
        event_name, params = matched
        data = dict(params)

        self.assertEqual(event_name, "On_PlayerWounded")
        self.assertEqual(data["VictimName"], "Victim")
        self.assertEqual(data["KillingDamage"], "80.000000")
        self.assertEqual(data["AttackerName"], "Attacker")

    def test_died_preserves_controller_identity_and_caused_by_nullptr(self) -> None:
        line = (
            "Die(): Player: 四不两直 KillingDamage=100.000000 "
            "from BP_PlayerController_C_2147413175 "
            "(Online IDs: EOS: 000277a1cfc74496b194ef11aa83ed4d steam: 76561199164842747 "
            "| Contoller ID: BP_PlayerController_C_2147413175) caused by nullptr"
        )

        matched = self.matcher.match(line)
        self.assertIsNotNone(matched)
        event_name, params = matched
        data = dict(params)

        self.assertEqual(event_name, "On_PlayerDied")
        self.assertEqual(data["VictimName"], "四不两直")
        self.assertEqual(data["KillingDamage"], "100.000000")
        self.assertEqual(data["FromObject"], "BP_PlayerController_C_2147413175")
        self.assertEqual(data["AttackerControllerID"], "BP_PlayerController_C_2147413175")
        self.assertEqual(data["AttackerEOSID"], "000277a1cfc74496b194ef11aa83ed4d")
        self.assertEqual(data["AttackerSteam64ID"], "76561199164842747")
        self.assertEqual(data["CausedBy"], "nullptr")

    def test_wounded_uses_from_object_controller_as_fallback(self) -> None:
        line = (
            "Wound(): Player: Victim KillingDamage=80.000000 "
            "from BP_PlayerController_C_2147413175 "
            "(Online IDs: EOS: 000277a1cfc74496b194ef11aa83ed4d steam: 76561199164842747 "
            "| Contoller ID: None) caused by BP_Weapon_C"
        )

        matched = self.matcher.match(line)
        self.assertIsNotNone(matched)
        _, params = matched
        data = dict(params)

        self.assertEqual(data["FromObject"], "BP_PlayerController_C_2147413175")
        self.assertEqual(data["AttackerControllerID"], "BP_PlayerController_C_2147413175")

    def test_vehicle_damage_noise_is_ignored(self) -> None:
        line = "LogSquad: SQVehicle::OnTakeDamage ActualDamage=100 caused by BP_Tank_C"
        self.assertIsNone(self.matcher.match(line))


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


class WorldBringUpMatcherTests(unittest.TestCase):
    def test_world_bring_up_event_is_generated(self) -> None:
        matcher = WorldBringUpMatcher()
        line = (
            "[2026.05.12-10.46.27:432][ 11]LogWorld: Bringing World "
            "/Game/Maps/Mutaha/Gameplay_Layers/Mutaha_RAAS_v1.Mutaha_RAAS_v1 "
            "up for play (max tick rate 50) at 2026.05.12-18.46.27"
        )

        matched = matcher.match(line)
        self.assertIsNotNone(matched)
        event_name, params = matched
        data = dict(params)

        self.assertEqual(event_name, "round.world_bring_up")
        self.assertEqual(data["logLineTime"], "2026.05.12-10.46.27:432")
        self.assertEqual(data["frame"], "11")
        self.assertEqual(data["worldPath"], "/Game/Maps/Mutaha/Gameplay_Layers/Mutaha_RAAS_v1.Mutaha_RAAS_v1")
        self.assertEqual(data["layerName"], "Mutaha_RAAS_v1")
        self.assertEqual(data["mapName"], "Mutaha")
        self.assertEqual(data["gameMode"], "RAAS")
        self.assertEqual(data["maxTickRate"], "50")
        self.assertEqual(data["serverPlayAt"], "2026.05.12-18.46.27")

    def test_world_bring_up_parses_map_name_with_underscore(self) -> None:
        matcher = WorldBringUpMatcher()
        line = (
            "[2026.05.12-10.46.27:432][ 11]LogWorld: Bringing World "
            "/Game/Maps/Tallil_Outskirts/Gameplay_Layers/Tallil_Outskirts_AAS_v1.Tallil_Outskirts_AAS_v1 "
            "up for play (max tick rate 60) at 2026.05.12-18.46.27"
        )

        matched = matcher.match(line)
        self.assertIsNotNone(matched)
        _, params = matched
        data = dict(params)

        self.assertEqual(data["layerName"], "Tallil_Outskirts_AAS_v1")
        self.assertEqual(data["mapName"], "Tallil_Outskirts")
        self.assertEqual(data["gameMode"], "AAS")


class IdSanitizationTests(unittest.TestCase):
    def test_parse_online_ids_strips_trailing_non_digits_from_steam64(self) -> None:
        _, steam = parse_online_ids(
            "[2026.05.07-13.30.34:241][259]LogSquadTrace: [DedicatedServer]Die(): Player: A "
            "KillingDamage=-300.000000 from BP_PlayerController_C_2146370936 "
            "(Online IDs: EOS: 0002a5a45cd94723b5b0f70c8d932615 steam: 76561199134649454) "
            "| Contoller ID: BP_PlayerController_C_2146370936) caused by BP_Soldier_X"
        )

        self.assertEqual(steam, "76561199134649454")


class EventBuilderTests(unittest.TestCase):
    def test_from_object_nullptr_is_preserved(self) -> None:
        builder = EventBuilder("BZSS_Main", "session", 1000)
        event = builder.build(
            "On_PlayerDied",
            [("FromObject", "nullptr"), ("CausedBy", "nullptr"), ("AttackerEOSID", "INVALID")],
            "raw",
        )

        self.assertEqual(event["Param1_FromObject"], "nullptr")
        self.assertEqual(event["Param2_CausedBy"], "nullptr")
        self.assertEqual(event["Param3_AttackerEOSID"], "")

    def test_raw_log_line_event_is_generated(self) -> None:
        builder = EventBuilder("BZSS_Main", "session", 1000)
        event = builder.build_raw_log_line(
            "[2026.05.08-10.00.02:000][1]LogSquadTrace: raw hello",
            source="Squad.log",
        )

        self.assertEqual(event["Event"], "On_RawLogLine")
        self.assertEqual(event["Param1_Source"], "Squad.log")
        self.assertEqual(event["Param2_Channel"], "LogSquadTrace")
        self.assertEqual(event["Raw"], "[2026.05.08-10.00.02:000][1]LogSquadTrace: raw hello")


if __name__ == "__main__":
    unittest.main()
