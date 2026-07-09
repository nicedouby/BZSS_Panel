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
            "storage": {
                "write_v2_events": True,
                "write_legacy_events": True,
                "write_v2_raw_archive": True,
                "write_legacy_raw_archive": True,
            },
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
            "checkpoint": {
                "flush_every_lines": 1,
                "flush_every_ms": 1,
                "force_on_event": True,
            },
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

        app.process_line({
            "line": line,
            "offset": 12,
            "next_offset": 77,
            "sourcePath": "SquadGame.log",
            "fileId": "file-1",
        })

        today = today_string()
        received_path = pathlib.Path(app.raw_input_writer.output_dir) / today / "Received.log"
        preserved_path = pathlib.Path(app.writer.output_dir) / today / "Preserved.jsonl"
        unknown_path = pathlib.Path(app.writer.output_dir) / today / "Unknown.jsonl"
        raw_archive_path = pathlib.Path(app.writer.output_dir) / "Raw" / today / "all.jsonl"
        state_path = pathlib.Path(app.writer.output_dir) / ".state" / "tailer-state.json"

        self.assertIn(line, received_path.read_text(encoding="utf-8"))
        raw_archive = self.read_jsonl(raw_archive_path)
        self.assertEqual(raw_archive[0]["seq"], 1)
        self.assertEqual(raw_archive[0]["offset"], 12)
        self.assertTrue(preserved_path.exists())
        preserved = self.read_jsonl(preserved_path)
        self.assertEqual(preserved[0]["MatchedRule"], "LogNet: Join succeeded:")
        self.assertEqual(json.loads(state_path.read_text(encoding="utf-8"))["seq"], 1)
        self.assertEqual(json.loads(state_path.read_text(encoding="utf-8"))["offset"], 77)
        self.assertEqual(len(app.udp_sender.sent), 1)
        self.assertEqual(app.udp_sender.sent[0]["Event"], "On_RawLogLine")
        self.assertEqual(app.udp_sender.sent[0]["SourceSeq"], "1")
        self.assertFalse(unknown_path.exists())
        self.assertEqual(app.stats["lines_preserved"], 1)
        self.assertEqual(app.stats["lines_blacklisted"], 0)

    def test_post_login_is_preserved(self) -> None:
        app = self.make_app()
        line = (
            "LogNet: PostLogin: NewPlayer: BP_PlayerController_C_1 "
            "(IP: 127.0.0.1| Online IDs: EOS:1234567890abcdef)"
        )

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

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

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        preserved = self.read_jsonl(preserved_path)
        self.assertEqual(preserved[0]["MatchedRule"], "LogSquad: PostLogin: NewPlayer:")
        self.assertEqual(len(app.udp_sender.sent), 1)

    def test_connection_close_is_preserved(self) -> None:
        app = self.make_app()
        line = "LogNet: UNetConnection::Close: RemoteAddr: 127.0.0.1:12345"

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        preserved = self.read_jsonl(preserved_path)
        self.assertEqual(preserved[0]["MatchedRule"], "LogNet: UNetConnection::Close:")

    def test_precise_noise_rule_is_still_blacklisted(self) -> None:
        app = self.make_app()
        line = "LogGameMode: FindPlayerStart_Implementation()"

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        unknown_path = pathlib.Path(app.writer.output_dir) / today_string() / "Unknown.jsonl"
        raw_archive_path = pathlib.Path(app.writer.output_dir) / "Raw" / today_string() / "all.jsonl"
        self.assertFalse(preserved_path.exists())
        self.assertFalse(unknown_path.exists())
        self.assertFalse(raw_archive_path.exists())
        self.assertEqual(len(app.udp_sender.sent), 0)
        self.assertEqual(app.stats["lines_blacklisted"], 1)

    def test_source_seq_advances_across_blacklisted_lines_without_event_seq(self) -> None:
        app = self.make_app()
        app.matchers = [StubMatcher("important", "On_Important")]

        app.process_line({
            "line": "LogGameMode: FindPlayerStart_Implementation()",
            "offset": 0,
            "next_offset": 44,
            "sourcePath": "SquadGame.log",
            "fileId": "file-1",
        })
        app.process_line({
            "line": "important structured event",
            "offset": 44,
            "next_offset": 71,
            "sourcePath": "SquadGame.log",
            "fileId": "file-1",
        })

        today = today_string()
        event_path = pathlib.Path(app.writer.output_dir) / today / "On_Important.jsonl"
        event = self.read_jsonl(event_path)[0]
        state_path = pathlib.Path(app.writer.output_dir) / ".state" / "tailer-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))

        self.assertEqual(event["Seq"], "1")
        self.assertEqual(event["SourceSeq"], "2")
        self.assertEqual(state["seq"], 2)
        self.assertEqual(state["offset"], 71)

    def test_preserve_wins_when_line_also_contains_blacklist_noise(self) -> None:
        app = self.make_app(
            blacklist_contains=["LogNet:", "FindPlayerStart_Implementation()"]
        )
        line = (
            "LogNet: Join succeeded: TestPlayer "
            "FindPlayerStart_Implementation()"
        )

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        self.assertTrue(preserved_path.exists())
        self.assertEqual(app.stats["lines_preserved"], 1)
        self.assertEqual(app.stats["lines_blacklisted"], 0)

    def test_matcher_wins_before_preserve(self) -> None:
        app = self.make_app()
        app.matchers = [StubMatcher("LogNet: Join succeeded:")]
        line = "[2026.06.09-12.00.00:000]LogNet: Join succeeded: TestPlayer"

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        event_path = pathlib.Path(app.writer.output_dir) / today_string() / "On_TestEvent.jsonl"
        preserved_path = pathlib.Path(app.writer.output_dir) / today_string() / "Preserved.jsonl"
        self.assertTrue(event_path.exists())
        self.assertFalse(preserved_path.exists())
        self.assertEqual(len(app.udp_sender.sent), 1)
        self.assertEqual(app.udp_sender.sent[0]["Event"], "On_TestEvent")
        self.assertEqual(app.stats["events_matched"], 1)
        self.assertEqual(app.stats["lines_preserved"], 0)

    def test_unmatched_line_is_written_to_unknown_with_source_meta(self) -> None:
        app = self.make_app(unknown={"write_unknown": True})
        line = "[2026.06.09-12.00.00:000]LogSomething: no matcher hit"

        app.process_line({"line": line, "offset": 33, "next_offset": 33 + len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        unknown_path = pathlib.Path(app.writer.output_dir) / today_string() / "Unknown.jsonl"
        unknown = self.read_jsonl(unknown_path)
        self.assertEqual(unknown[0]["SourceSeq"], "1")
        self.assertEqual(unknown[0]["SourceOffset"], "33")
        self.assertTrue(unknown[0]["RawLineHash"])

    def test_raw_archive_is_not_written_twice(self) -> None:
        app = self.make_app(unknown={"write_unknown": True})
        line = "[2026.06.09-12.00.00:000]LogSomething: no matcher hit"

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        raw_archive_path = pathlib.Path(app.writer.output_dir) / "Raw" / today_string() / "all.jsonl"
        raw_segment_path = pathlib.Path(app.writer.output_dir) / "raw" / today_string() / "segment-000001.jsonl"
        self.assertEqual(len(raw_archive_path.read_text(encoding="utf-8").splitlines()), 1)
        self.assertEqual(len(raw_segment_path.read_text(encoding="utf-8").splitlines()), 1)

    def test_compact_storage_writes_only_v2_and_respects_unknown_toggle(self) -> None:
        app = self.make_app(
            storage={
                "write_v2_events": True,
                "write_legacy_events": False,
                "write_v2_raw_archive": True,
                "write_legacy_raw_archive": False,
            },
            unknown={"write_unknown": False},
        )
        line = "[2026.06.09-12.00.00:000]LogSomething: no matcher hit"

        app.process_line({"line": line, "offset": 0, "next_offset": len(line) + 1, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        today = today_string()
        legacy_unknown = pathlib.Path(app.writer.output_dir) / today / "Unknown.jsonl"
        legacy_all = pathlib.Path(app.writer.output_dir) / today / "All.jsonl"
        legacy_raw = pathlib.Path(app.writer.output_dir) / "Raw" / today / "all.jsonl"
        v2_unknown = pathlib.Path(app.writer.output_dir) / "events" / today / "unknown.jsonl"
        v2_all = pathlib.Path(app.writer.output_dir) / "events" / today / "all.jsonl"
        v2_raw = pathlib.Path(app.writer.output_dir) / "raw" / today / "segment-000001.jsonl"

        self.assertFalse(legacy_unknown.exists())
        self.assertFalse(legacy_all.exists())
        self.assertFalse(legacy_raw.exists())
        self.assertFalse(v2_unknown.exists())
        self.assertTrue(v2_all.exists())
        self.assertTrue(v2_raw.exists())

    def test_matcher_exception_goes_to_parse_error_and_next_matcher_still_runs(self) -> None:
        class BrokenMatcher:
            def match(self, line: str):
                raise RuntimeError("boom")

        app = self.make_app()
        app.matchers = [BrokenMatcher(), StubMatcher("matched", "On_AfterBroken")]

        app.process_line({"line": "matched", "offset": 1, "next_offset": 9, "sourcePath": "SquadGame.log", "fileId": "file-1"})

        parse_error_path = pathlib.Path(app.writer.output_dir) / today_string() / "ParseError.jsonl"
        parse_errors = self.read_jsonl(parse_error_path)
        self.assertIn("BrokenMatcher", parse_errors[0]["Error"])
        event_path = pathlib.Path(app.writer.output_dir) / today_string() / "On_AfterBroken.jsonl"
        self.assertTrue(event_path.exists())

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

    def test_restart_resumes_from_processed_line_boundary_not_batch_eof(self) -> None:
        app = self.make_app(tail={"from_end": False, "reopen_on_truncate": True})
        log_path = pathlib.Path(app.config["log_file"])
        first_line = "first important line"
        second_line = "second important line"
        log_bytes = f"{first_line}\n{second_line}\n".encode("utf-8")
        log_path.write_bytes(log_bytes)
        first_boundary = len(f"{first_line}\n".encode("utf-8"))

        records = app.tail_reader.read_new_lines()
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["offset"], 0)
        self.assertEqual(records[0]["next_offset"], first_boundary)
        self.assertEqual(records[1]["offset"], first_boundary)

        app.process_line(records[0])

        state_path = pathlib.Path(app.writer.output_dir) / ".state" / "tailer-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["offset"], first_boundary)
        app.tail_reader.close()

        restarted = BzssLogParserApp(app.config)
        restarted.udp_sender.sock.close()
        restarted.matchers = []
        restarted.udp_sender = StubUdpSender()
        restarted.console = StubConsole()

        resumed_records = restarted.tail_reader.read_new_lines()
        self.assertEqual([record["line"] for record in resumed_records], [second_line])
        restarted.tail_reader.close()

    def test_transport_only_sends_udp_without_disk_writes(self) -> None:
        app = self.make_app(
            transport_only=True,
            storage={
                "write_v2_events": True,
                "write_legacy_events": True,
                "write_v2_raw_archive": True,
                "write_legacy_raw_archive": True,
            },
            preserve={
                "enabled": True,
                "write_file": True,
                "file_name": "Preserved.jsonl",
                "contains": ["transport preserve hit"],
            },
            checkpoint={
                "flush_every_lines": 1,
                "flush_every_ms": 1,
                "force_on_event": True,
            },
        )
        app.matchers = [StubMatcher("matched", "On_TransportMatched")]

        app.process_line({
            "line": "matched line",
            "offset": 0,
            "next_offset": 13,
            "sourcePath": "SquadGame.log",
            "fileId": "file-1",
        })
        app.process_line({
            "line": "transport raw line",
            "offset": 13,
            "next_offset": 32,
            "sourcePath": "SquadGame.log",
            "fileId": "file-1",
        })

        sent_events = [event["Event"] for event in app.udp_sender.sent]
        self.assertEqual(sent_events, ["On_TransportMatched", "On_RawLogLine"])
        self.assertEqual(app.stats["events_matched"], 1)
        self.assertEqual(app.stats["rawlog_forwarded"], 1)

        output_dir = pathlib.Path(app.writer.output_dir)
        received_dir = pathlib.Path(app.raw_input_writer.output_dir)
        self.assertFalse(output_dir.exists())
        self.assertFalse(received_dir.exists())
        self.assertFalse((output_dir / ".state").exists())
        self.assertFalse((output_dir / "outbox").exists())
        self.assertFalse((output_dir / "events").exists())
        self.assertFalse((output_dir / "raw").exists())


if __name__ == "__main__":
    unittest.main()
