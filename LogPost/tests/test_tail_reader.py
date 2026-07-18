import pathlib
import shutil
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bzss_parser.source_state_store import SourceStateStore
from bzss_parser.tail_reader import TailReader


class TailReaderReliabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = pathlib.Path(tempfile.mkdtemp(prefix="logpost-tail-"))
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))
        self.log_path = self.root / "SquadGame.log"
        self.state_store = SourceStateStore(str(self.root / "tail-state.json"))

    def make_reader(self, **overrides) -> TailReader:
        options = {
            "log_file": str(self.log_path),
            "from_end": False,
            "reopen_on_truncate": True,
            "state_store": self.state_store,
            "read_chunk_bytes": 4096,
            "max_recovery_bytes": 8192,
            "max_line_bytes": 4096,
        }
        options.update(overrides)
        reader = TailReader(**options)
        self.addCleanup(reader.close)
        return reader

    def read_until_idle(self, reader: TailReader):
        records = []
        for _ in range(20):
            batch = reader.read_new_lines()
            records.extend(batch)
            if not batch and reader.position == self.log_path.stat().st_size:
                break
        return records

    def test_reads_large_append_in_chunks_without_losing_boundaries(self) -> None:
        lines = ["a" * 3000, "b" * 3000, "c" * 3000]
        self.log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        records = self.read_until_idle(self.make_reader())

        self.assertEqual([record["line"] for record in records], lines)
        self.assertEqual(records[-1]["next_offset"], self.log_path.stat().st_size)

    def test_replaced_file_never_reuses_old_file_offset(self) -> None:
        self.log_path.write_text("old-line\n", encoding="utf-8")
        old_stat = self.log_path.stat()
        self.state_store.save(
            source_path=str(self.log_path),
            file_id=TailReader._make_file_id(old_stat),
            offset=8,
            seq=1,
        )
        replacement = self.root / "replacement.log"
        replacement.write_text("new-first\nnew-second\n", encoding="utf-8")
        replacement.replace(self.log_path)

        reader = self.make_reader()
        records = self.read_until_idle(reader)

        self.assertEqual(reader.consume_rotate_reason(), "file_replaced")
        self.assertEqual([record["line"] for record in records], ["new-first", "new-second"])
        self.assertEqual(records[0]["offset"], 0)

    def test_stale_checkpoint_is_capped_to_recovery_window(self) -> None:
        lines = [f"line-{index}-" + (str(index) * 1000) for index in range(8)]
        self.log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        stat = self.log_path.stat()
        self.state_store.save(
            source_path=str(self.log_path),
            file_id=TailReader._make_file_id(stat),
            offset=1,
            seq=1,
        )

        reader = self.make_reader(max_recovery_bytes=2200)
        records = self.read_until_idle(reader)

        self.assertEqual(reader.consume_rotate_reason(), "checkpoint_too_old")
        self.assertGreaterEqual(records[0]["offset"], stat.st_size - 2200)
        self.assertNotIn(lines[0], [record["line"] for record in records])
        self.assertEqual(records[-1]["line"], lines[-1])

    def test_oversized_line_is_bounded_and_next_line_is_kept(self) -> None:
        self.log_path.write_bytes((b"x" * 10000) + b"\nnext-line\n")

        records = self.read_until_idle(self.make_reader())

        self.assertEqual(len(records), 2)
        self.assertTrue(records[0]["lineTruncated"])
        self.assertLessEqual(len(records[0]["line"]), 4096 + len("...[LINE_TRUNCATED]"))
        self.assertEqual(records[0]["next_offset"], 10001)
        self.assertEqual(records[1]["line"], "next-line")


if __name__ == "__main__":
    unittest.main()
