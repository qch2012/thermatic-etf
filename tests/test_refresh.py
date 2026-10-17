import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from pipeline.__main__ import ROOT, run
from pipeline.checks import check, validate
from pipeline.method import score
from pipeline.sources.stub import Stub

HEADER = "Symbol|Security Name|ETF|Test Issue\n"


def directory(count):
    return HEADER + "".join(f"F{i}|Example Semiconductor ETF|Y|N\n" for i in range(count))


class ChecksTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def good(self):
        return run({"data_source": "stub"}, self.path / "screen.json", self.path / "cache", directory(10))

    def test_validate_reports_type_required_and_nested_errors(self):
        schema = {"type": "object", "required": ["a"], "properties": {
            "a": {"type": ["number", "null"]}, "b": {"type": "array", "items": {"type": "string"}}}}
        self.assertEqual(validate({"a": None, "b": ["x"]}, schema), [])
        self.assertEqual(validate({"a": True}, schema), ["$.a: expected number or null"])  # bool is not a number
        self.assertEqual(validate({}, schema), ["$: missing a"])
        self.assertEqual(validate({"a": 1, "b": ["x", 2]}, schema), ["$.b[1]: expected string"])

    def test_clean_run_passes_and_schema_catches_broken_json(self):
        result = self.good()
        self.assertEqual(check(result, None), ([], []))
        broken = copy.deepcopy(result)
        del broken["funds"][0]["ticker"]
        broken["generated_at"] = 5
        errors, _ = check(broken, None)
        self.assertEqual(sorted(errors), ["Schema: $.funds[0]: missing ticker", "Schema: $.generated_at: expected string"])

    def test_ninety_percent_fetched(self):
        result = self.good()
        result["failed_fetches"] = [{"ticker": "F0", "error": "x"}]  # 1 of 10 = exactly 90% fetched
        self.assertEqual(check(result, None)[0], [])
        result["failed_fetches"].append({"ticker": "F1", "error": "x"})
        self.assertEqual(check(result, None)[0], ["Fewer than 90% of candidates fetched successfully (2 of 10 failed)"])

    def test_theme_losing_all_eligible_funds_to_fetch_errors(self):
        previous = self.good()
        result = copy.deepcopy(previous)
        result["themes"] = []
        result["failed_fetches"] = [{"ticker": "F0", "error": "x"}]
        errors, _ = check(result, previous)
        self.assertEqual(errors, ["Theme Semiconductors lost all its eligible funds and has failed fetches: F0"])
        result["failed_fetches"] = []  # lost them for real (e.g. gates), not because of fetch errors
        self.assertEqual(check(result, previous)[0], [])

    def test_big_net_asset_moves_are_noted_not_blocking(self):
        previous = self.good()
        result = copy.deepcopy(previous)
        result["funds"][0]["net_assets"] = previous["funds"][0]["net_assets"] * 1.6
        result["funds"][1]["net_assets"] = previous["funds"][1]["net_assets"] * 1.4
        errors, notes = check(result, previous)
        self.assertEqual(errors, [])
        self.assertEqual(len(notes), 1)
        self.assertIn(result["funds"][0]["ticker"], notes[0])
        self.assertIn("+60%", notes[0])


class RefreshRunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def test_fund_without_last_good_data_is_published_as_no_price_data(self):
        original = Stub.profile

        def profile(source, ticker):
            if ticker == "F0":
                raise RuntimeError("offline")
            return original(source, ticker)

        with patch.object(Stub, "profile", profile):
            result = run({"data_source": "stub"}, self.path / "screen.json", self.path / "cache", directory(10))
        f0 = next(f for f in result["funds"] if f["ticker"] == "F0")
        self.assertEqual((f0["status"], f0["new"], f0["rank"], f0["score"]), ("No price data", False, None, None))
        self.assertEqual([x["ticker"] for x in result["failed_fetches"]], ["F0"])
        self.assertFalse((self.path / "prices/F0.json").exists())
        self.assertEqual(json.loads((self.path / "screen.json").read_text()), result)

    def test_prices_of_tickers_not_in_this_run_are_deleted(self):
        (self.path / "prices").mkdir()
        (self.path / "prices/GONE.json").write_text("{}")
        run({"data_source": "stub"}, self.path / "screen.json", self.path / "cache", directory(10))
        names = sorted(p.name for p in (self.path / "prices").iterdir())
        self.assertEqual(names, sorted(f"F{i}.json" for i in range(10)))

    def test_funds_with_unknown_age_are_not_new(self):
        f = {"ticker": "X", "prices": [], "net_assets": None, "first_trade_date": None}
        score([f])
        self.assertEqual((f["status"], f["new"]), ("No price data", False))
        young = {"ticker": "Y", **Stub().history("Y"), **Stub().profile("Y")}
        young["prices"] = young["prices"][-60:]
        young["first_trade_date"] = young["prices"][0]["date"]
        score([young])
        self.assertTrue(young["new"])

    def test_twenty_percent_simulated_failures_publish_nothing(self):
        good = run({"data_source": "stub"}, self.path / "screen.json", self.path / "cache", directory(50))
        files = lambda: {p: p.read_bytes() for p in self.path.rglob("*.json") if "cache" not in p.parts}
        before = files()
        with patch.dict(os.environ, {"STUB_FAIL_RATE": "0.2"}):
            with self.assertRaisesRegex(RuntimeError, "90%"):
                run({"data_source": "stub"}, self.path / "screen.json", self.path / "cache", directory(50))
        self.assertEqual(before, files())
        self.assertEqual(good["failed_fetches"], [])

    def test_cli_exits_nonzero_with_reason_when_checks_fail(self):
        fixture = ROOT / "tests/fixtures/nasdaqtraded_2026-10-17_seed_tickers.txt"
        settings = self.path / "settings.yaml"
        settings.write_text("data_source: stub\n")
        output = self.path / "data/screen.json"
        command = [sys.executable, "-m", "pipeline", "--settings", str(settings), "--output", str(output), "--directory", str(fixture)]
        env = {**os.environ, "STUB_FAIL_RATE": "0.2"}
        failed = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(failed.returncode, 1)
        self.assertIn("Not publishing: Fewer than 90%", failed.stderr)
        self.assertFalse(output.exists())
        env.pop("STUB_FAIL_RATE")
        ok = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertTrue(output.exists())
