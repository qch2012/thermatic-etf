import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pipeline.__main__ import CheckFailed, run
from pipeline.sources.stub import Stub


def directory(count):
    return "Symbol|Security Name|ETF|Test Issue\n" + "".join(f"F{i}|Example Semiconductor ETF|Y|N\n" for i in range(count))


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def run_stub(self, count=10):
        return run({"data_source": "stub"}, self.path / "screen.json", self.path / "cache", directory(count))

    def test_run_writes_compact_snapshot_named_by_utc_date_and_index(self):
        result = self.run_stub()
        day = result["generated_at"][:10]
        text = (self.path / "history" / f"{day}.json").read_text()
        self.assertNotIn(" ", text)  # compact
        snapshot = json.loads(text)
        self.assertEqual(snapshot["date"], day)
        self.assertEqual(sorted(snapshot["funds"]), sorted(f["ticker"] for f in result["funds"]))
        for f in result["funds"]:
            expected = [f["theme"], f["rank"], None if f["score"] is None else round(f["score"], 2),
                        None if f["net_assets"] is None else round(f["net_assets"])]
            self.assertEqual(snapshot["funds"][f["ticker"]], expected)
        self.assertEqual(json.loads((self.path / "history/index.json").read_text()), [day])

    def test_index_lists_all_dates_oldest_first_and_same_day_rerun_overwrites(self):
        (self.path / "history").mkdir()
        for old in ("2026-10-09", "2026-10-02"):
            (self.path / f"history/{old}.json").write_text('{"date":"%s","funds":{}}' % old)
        result = self.run_stub()
        self.run_stub()
        day = result["generated_at"][:10]
        self.assertEqual(json.loads((self.path / "history/index.json").read_text()), ["2026-10-02", "2026-10-09", day])
        self.assertEqual(len(list((self.path / "history").glob("2*.json"))), 3)

    def test_failed_checks_write_no_snapshot(self):
        with patch.object(Stub, "profile", side_effect=RuntimeError("offline")):
            with self.assertRaises(CheckFailed):
                self.run_stub()
        self.assertFalse((self.path / "history").exists())
