import json
import tempfile
import unittest
from pathlib import Path

from bzss_parser.buffered_file_writer import BufferedFileWriter, write_text_atomic


class BufferedFileWriterTests(unittest.TestCase):
    def test_batch_writer_and_atomic_write(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "events.jsonl"
            writer = BufferedFileWriter(target, flush_interval_ms=100000, batch_bytes=1024)
            writer.write('{"seq":1}\n')
            self.assertFalse(target.exists())
            writer.flush(force=True)
            self.assertEqual(target.read_text(encoding="utf-8"), '{"seq":1}\n')
            writer.close()

            state = root / "state.json"
            write_text_atomic(state, json.dumps({"revision": 1}) + "\n")
            self.assertEqual(json.loads(state.read_text(encoding="utf-8"))["revision"], 1)


if __name__ == "__main__":
    unittest.main()
