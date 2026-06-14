import json
import pathlib
import shutil
import sys
import unittest
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bzss_parser.app import BzssLogParserApp
from bzss_parser.helpers import today_string


class StubMatcher:
    def __init__(self, token: str, event_name: str = "On_TestEvent") -> None:
        self.token = token
        self.event_name = event_name

    def match(self, line: str):
        if self.token and self.token in line:
            return self.event_name, [("Value", line)]
        return None


class StubUdpSender:
    def __init__(self) -> None:
        self.sent = []

    def send(self, event) -> None:
        self.sent.append(event)


class StubConsole:
    def __init__(self) -> None:
        self.warns = []
        self.infos = []
        self.events = []

    def warn(self, message: str) -> None:
        self.warns.append(message)

    def info(self, message: str) -> None:
        self.infos.append(message)

    def event(self, event) -> None:
        self.events.append(event)

    def error(self, message: str) -> None:
        self.warns.append(message)


class LogPostPipelineTests(unittest.TestCase):
    def make_app(self, **overrides) -> BzssLogParserApp:
        base_dir = ROOT.parent / "tmp_test_output"
        base_dir.mkdir(parents=True, exist_ok=True)
        root = base_dir / f"case_{uuid.uuid4().hex[:8]}"
        root.mkdir(parents=True, exist_ok=True)
        self.addCleanup(lambda: shutil.rmtree(root, ignore_errors=True))

        config = {
            "server_id": "BZSS_Test",
            "log_file": str(root / "Squad.log"),
            "output_dir": str(root / "LogPost"),
            "poll_interval_ms": 200,
            "tail": {"from_end": True, "reopen_on_truncate": True},
            "udp": {"enabled": True, "host": "127.0.0.1", "port": 7788, "max_payload_bytes": 8192},
            "unknown": {"write_unknown": False},
            "preserve": {
                "enabled": True,
                "write_file": True,
                "file_name": "Preserved.jsonl",
                "contains": [
                    "LogNet: Join succeeded:",
                    "LogNet: PostLogin: NewPlayer:",
                    "LogSquad: PostLogin: NewPlayer:",
                    "LogNet: UNetConnection::Close:",
                ],
            },
            "raw": {"max_raw_chars": 4096},
            "raw_input_log": {
                "enabled": True,
                "output_dir": str(root / "ReceivedLogs"),
                "file_name": "Received.log",
                "format": "raw",
            },
            "raw_log_output": {"enabled": True, "source": "Squad.log"},
            "blacklist_contains": [
                "FindPlayerStart_Implementation()",
                "VehicleMovementComponent",
                "LogNet:",
            ],
            "console": {
                "enabled": True,
                "use_color": False,
                "show_params": True,
                "max_params": 8,
                "max_param_chars": 36,
                "show_log_time": True,
            },
        }
        config.update(overrides)
        app = BzssLogParserApp(config)
        app.udp_sender.sock.close()
        app.matchers = []
        app.udp_sender = StubUdpSender()
        app.console = StubConsole()
        return app

    def read_jsonl(self, path: pathlib.Path):
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]

    def test_join_succeeded_is_preserved_before_blacklist(self) -> None:
        app = self.make_app()
        line = "[2026.06.09-12.00.00:000]LogNet: Join succeeded: TestPlayer"

        app.process_line(line)

        today = today_string()
        received_path = pathlib.Path(app.raw_input_writer.output_dir) / today / "Received.log"
        preserved_path = pathlib.Path(app.writer.output_dir) / today / "Preserved.jsonl"
        unknown_path = pathlib.Path(app.writer.output_dir) / today / "Unknown.jsonl"

        self.assertIn(line, received_path.read_text(encoding="utf-8"))
        self.assertTrue(preserved_path.exists())
        preserved = self.read_jsonl(preserved_path)
        self.assertEqual(preserved[0]["MatchedRule"], "LogNet: Join succeeded:")
        self.assertEqual(len(app.udp_sender.sent), 1)
        self.assertEqual(app.udp_sender.sent[0]["Event"], "On_RawLogLine")
        self.assertFalse(unknown_path.exists())
        self.assertEqual(app.stats["lines_preserved"], 1)
        self.assertEqual(app.stats["lines_blacklisted"], 0)

    def test_post_login_is_preserved(self) -> None:
        app = self.make_app()
        line = (
            "LogNet: PostLogin: NewPlayer: BP_PlayerController_C_1 "
            "(IP: 127.0.0.1| Online IDs: EOS:1234567890abcdef)"
        )

        app.process_line(line)

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        preserved = self.read_jsonl(preserved_path)
        self.assertEqual(preserved[0]["MatchedRule"], "LogNet: PostLogin: NewPlayer:")
        self.assertEqual(len(app.udp_sender.sent), 1)

    def test_log_squad_post_login_is_preserved(self) -> None:
        app = self.make_app()
        line = (
            "LogSquad: PostLogin: NewPlayer: BP_PlayerController_C_1 "
            "(IP: 127.0.0.1 | Online IDs: EOS: 1234567890abcdef steam: 76561198000000000)"
        )

        app.process_line(line)

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        preserved = self.read_jsonl(preserved_path)
        self.assertEqual(preserved[0]["MatchedRule"], "LogSquad: PostLogin: NewPlayer:")
        self.assertEqual(len(app.udp_sender.sent), 1)

    def test_connection_close_is_preserved(self) -> None:
        app = self.make_app()
        line = "LogNet: UNetConnection::Close: RemoteAddr: 127.0.0.1:12345"

        app.process_line(line)

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        preserved = self.read_jsonl(preserved_path)
        self.assertEqual(preserved[0]["MatchedRule"], "LogNet: UNetConnection::Close:")

    def test_precise_noise_rule_is_still_blacklisted(self) -> None:
        app = self.make_app()
        line = "LogGameMode: FindPlayerStart_Implementation()"

        app.process_line(line)

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        unknown_path = pathlib.Path(app.writer.output_dir) / today_string() / "Unknown.jsonl"
        self.assertFalse(preserved_path.exists())
        self.assertFalse(unknown_path.exists())
        self.assertEqual(len(app.udp_sender.sent), 1)
        self.assertEqual(app.stats["lines_blacklisted"], 1)

    def test_preserve_wins_when_line_also_contains_blacklist_noise(self) -> None:
        app = self.make_app(
            blacklist_contains=["LogNet:", "FindPlayerStart_Implementation()"]
        )
        line = (
            "LogNet: Join succeeded: TestPlayer "
            "FindPlayerStart_Implementation()"
        )

        app.process_line(line)

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        self.assertTrue(preserved_path.exists())
        self.assertEqual(app.stats["lines_preserved"], 1)
        self.assertEqual(app.stats["lines_blacklisted"], 0)

    def test_matcher_wins_before_preserve(self) -> None:
        app = self.make_app()
        app.matchers = [StubMatcher("LogNet: Join succeeded:")]
        line = "[2026.06.09-12.00.00:000]LogNet: Join succeeded: TestPlayer"

        app.process_line(line)

        event_path = pathlib.Path(app.writer.output_dir) / today_string() / "On_TestEvent.jsonl"
        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        self.assertTrue(event_path.exists())
        self.assertFalse(preserved_path.exists())
        self.assertEqual(len(app.udp_sender.sent), 2)
        self.assertEqual(app.udp_sender.sent[0]["Event"], "On_RawLogLine")
        self.assertEqual(app.udp_sender.sent[1]["Event"], "On_TestEvent")
        self.assertEqual(app.stats["events_matched"], 1)
        self.assertEqual(app.stats["lines_preserved"], 0)

    def test_broad_channel_blacklist_rule_is_rejected(self) -> None:
        app = self.make_app(blacklist_contains=["LogNet:"])

        self.assertEqual(app.blacklist.contains_list, [])
        self.assertEqual(app.blacklist.rejected_rules, ["LogNet:"])

        app.run = lambda: None
        for rule in app.blacklist.rejected_rules:
            app.console.warn(f"Broad log-channel blacklist rule rejected: {rule}")
        self.assertIn(
            "Broad log-channel blacklist rule rejected: LogNet:",
            app.console.warns,
        )


if __name__ == "__main__":
    unittest.main()
