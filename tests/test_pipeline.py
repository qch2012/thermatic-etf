import csv
from datetime import date, datetime, timezone
import io
import json
import math
from pathlib import Path
import statistics
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

import yaml

from pipeline.__main__ import ROOT, run
from pipeline.method import classify, gate, percentiles, score
from pipeline.sources import create
from pipeline.sources.directory import parse
from pipeline.sources.http import Session
from pipeline.sources.stub import Stub
from pipeline.sources.yahoo import Yahoo

DIRECTORY = "Symbol|Security Name|ETF|Test Issue\nAAA|Example Semiconductor ETF|Y|N\nBBB|Other Chip ETF|Y|N\nCCC|2x Semiconductor ETF|Y|N\nDDD|Semiconductor Stock|N|N\nEEE|Test Chip ETF|Y|Y\n"


def fund(ticker="AAA"):
    return {"ticker": ticker, **Stub().history(ticker), **Stub().profile(ticker)}


class MethodTests(unittest.TestCase):
    def test_classifier_baseline_and_known_cases(self):
        config = yaml.safe_load((ROOT / "config/themes.yaml").read_text())
        mismatches = {}
        with (ROOT / "seed/universe_2026-10-06.csv").open() as file:
            for row in csv.DictReader(file):
                actual = classify(row["ticker"], row["name"], config)
                if actual != row["theme"]:
                    mismatches[row["ticker"]] = actual
        # Existing config/seed conflicts are documented in reports/issue-2.md.
        self.assertEqual(mismatches, {"WDEF": None, "ARKW": "Genomics & gene editing"})
        for ticker, name, expected in [
            ("LAZR", "Photonics ETF", "Photonics & optics"),
            ("MJ", "Generic ETF", "Cannabis"),
            ("X", "Blue Chip ETF", None),
            ("X", "2x Semiconductor ETF", None),
            ("X", "Memory Semiconductor ETF", "Memory & storage"),
        ]:
            self.assertEqual(classify(ticker, name, config), expected)

    def test_gates_order_boundaries(self):
        f = fund()
        f.update(prices=[], net_assets=None)
        self.assertEqual(gate(f), "No price data")
        f = fund()
        f["net_assets"] = None
        self.assertEqual(gate(f), "No net-asset data")
        f["net_assets"] = 100e6 - 1
        self.assertEqual(gate(f), "Under $100M (established minimum)")
        f["net_assets"] = 100e6
        self.assertEqual(gate(f), "Eligible")
        f["first_trade_date"] = f["prices"][-100]["date"]
        f["net_assets"] = 25e6 - 1
        self.assertEqual(gate(f), "Under $25M (emerging minimum)")
        f["net_assets"] = 25e6
        for p in f["prices"]:
            p.update(close=5, volume=100000)
        self.assertEqual(gate(f), "Eligible")
        f["prices"][-1]["volume"] -= 1
        self.assertEqual(gate(f), "Under $0.5M avg daily $ volume")

    def test_percentile_ties(self):
        self.assertEqual(percentiles({"a": 1, "b": 1, "c": 3}), {"a": 0.5, "b": 0.5, "c": 1})
        self.assertEqual(percentiles({"a": 1}), {"a": 1})
        self.assertEqual(percentiles({"a": 1, "b": 3}, True), {"a": 1, "b": 0.5})

    def test_alignment_metrics_and_young_fund(self):
        a, b, young = fund(), fund("BBB"), fund("NEW")
        b["first_trade_date"] = "2024-03-01"
        b["prices"] = [p for p in b["prices"] if p["date"] >= "2024-03-01"][::2]
        young["first_trade_date"] = young["prices"][-30]["date"]
        young["prices"] = young["prices"][-30:]
        window = score([a, b, young])
        self.assertEqual(window["start"], "2024-03-01")
        dates = sorted(set(p["date"] for p in a["prices"]) & set(p["date"] for p in b["prices"]))
        dates = [d for d in dates if window["start"] <= d <= window["end"]]
        prices = {p["date"]: p["adjusted_close"] for p in a["prices"]}
        aligned = [prices[d] for d in dates]
        length = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days / 365.25
        annual = (aligned[-1] / aligned[0]) ** (1 / length) - 1
        vol = statistics.stdev(math.log(y / x) for x, y in zip(aligned, aligned[1:])) * math.sqrt(252)
        self.assertEqual(window["years"], length)
        self.assertEqual(window["observations"], len(dates))
        self.assertAlmostEqual(a["cumulative_return"], aligned[-1] / aligned[0] - 1)
        self.assertAlmostEqual(a["annualized_return"], annual)
        self.assertAlmostEqual(a["volatility"], vol)
        self.assertAlmostEqual(a["ratio"], annual / vol)
        self.assertTrue(young["new"])
        self.assertEqual(young["percentiles"]["performance"], 0.5)
        self.assertIsNone(young["ratio"])

    def test_performance_uses_only_available_adjusted_closes(self):
        f = fund()
        f["first_trade_date"] = "2024-03-01"
        f["prices"] = [p for p in f["prices"] if "2024-03-01" <= p["date"] <= "2025-03-03"]
        for p in f["prices"]:
            if p["date"] in {"2024-07-01", "2025-03-03"}:
                p["adjusted_close"] = None
        window = score([f])
        self.assertEqual(window["start"], "2024-03-01")
        self.assertEqual(window["end"], "2025-02-28")
        self.assertEqual(window["observations"], 260)
        self.assertTrue(math.isfinite(f["ratio"]))
        self.assertEqual(f["prices"][-1]["date"], "2025-03-03")
        for p in f["prices"]:
            p["adjusted_close"] = None
        self.assertIsNone(score([f]))
        self.assertEqual(f["status"], "Eligible")
        self.assertEqual(f["percentiles"]["performance"], 0.5)

    def test_three_year_cap_sole_fund_and_missing_fee(self):
        f = fund()
        window = score([f])
        self.assertEqual(window["start"], "2023-01-02")
        self.assertEqual(f["score"], 100)
        f["expense_ratio"] = None
        score([f])
        self.assertEqual(f["percentiles"]["cost"], 0.5)
        self.assertEqual(f["score"], 90)

    def test_short_window_and_no_measured_funds(self):
        a, b = fund(), fund("BBB")
        b["prices"] = b["prices"][-30:]
        self.assertIsNone(score([a, b]))
        self.assertEqual(a["percentiles"]["performance"], 0.5)
        a["first_trade_date"] = a["prices"][-30]["date"]
        self.assertIsNone(score([a]))
        self.assertTrue(a["new"])


class PipelineTests(unittest.TestCase):
    def test_directory(self):
        self.assertEqual([f["ticker"] for f in parse(DIRECTORY)], ["AAA", "BBB", "CCC"])
        with self.assertRaises(ValueError):
            parse("Bad|Columns\n")
        with self.assertRaisesRegex(ValueError, "ticker"):
            parse(DIRECTORY.replace("AAA|", "../AAA|"))

    def test_stub_end_to_end_and_failed_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            output = path / "screen.json"
            settings = {"theme": "Semiconductors", "data_source": "stub"}
            result = run(settings, output, path / "cache", DIRECTORY)
            self.assertEqual(len(result["funds"]), 2)
            self.assertEqual(result["funds"][0]["rank"], 1)
            self.assertTrue(json.loads(output.read_text())["synthetic"])
            self.assertNotIn("prices", result["funds"][0])
            previous = output.read_bytes()
            with patch.object(Stub, "profile", side_effect=RuntimeError("offline")):
                with self.assertRaisesRegex(RuntimeError, "90%"):
                    run(settings, output, path / "cache", DIRECTORY)
            self.assertEqual(previous, output.read_bytes())
            # No prior cache must not silently drop a failed fund either.
            with patch.object(Stub, "profile", side_effect=RuntimeError("offline")):
                with self.assertRaisesRegex(RuntimeError, "no last-good"):
                    run(settings, output, path / "empty-cache", DIRECTORY)
            self.assertEqual(previous, output.read_bytes())

    def test_last_good_data_at_ninety_percent(self):
        directory = "Symbol|Security Name|ETF|Test Issue\n" + "".join(
            f"F{i}|Example Semiconductor ETF|Y|N\n" for i in range(10)
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            settings = {"theme": "Semiconductors", "data_source": "stub"}
            run(settings, path / "screen.json", path / "cache", directory)
            original = Stub.profile

            def profile(source, ticker):
                if ticker == "F0":
                    raise RuntimeError("offline")
                return original(source, ticker)

            with patch.object(Stub, "profile", profile):
                result = run(settings, path / "screen.json", path / "cache", directory)
            self.assertEqual(len(result["funds"]), 10)
            self.assertTrue(next(f for f in result["funds"] if f["ticker"] == "F0")["stale"])
            self.assertEqual(len(result["failed_fetches"]), 1)

    def test_adapter_selection(self):
        self.assertIsInstance(create("stub"), Stub)
        self.assertIsInstance(create("yahoo"), Yahoo)
        with self.assertRaises(ValueError):
            create("typo")

    def test_http_retry_and_throttle(self):
        session = Session()
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b"ok"
        session.opener = Mock()
        session.opener.open.side_effect = [urllib.error.HTTPError("url", 429, "busy", {}, io.BytesIO()), response]
        with patch("pipeline.sources.http.time.sleep") as sleep:
            self.assertEqual(session.get("url"), "ok")
        self.assertEqual(session.opener.open.call_count, 2)
        self.assertIn(1, [call.args[0] for call in sleep.call_args_list])
        self.assertTrue(any(0 < call.args[0] <= 0.3 for call in sleep.call_args_list))

    def test_yahoo_history_and_profile(self):
        yahoo = Yahoo()
        yahoo.crumb = "test"
        yahoo.session.get = Mock(side_effect=[
            json.dumps({"chart": {"result": [{"meta": {"firstTradeDate": 1641168000}, "timestamp": [1641168000, 1641254400], "indicators": {"quote": [{"close": [100, None], "volume": [1000, 1000]}], "adjclose": [{"adjclose": [99, None]}]}}]}}),
            json.dumps({"quoteSummary": {"result": [{"summaryDetail": {"totalAssets": {"raw": 200e6}}, "fundProfile": {"feesExpensesInvestment": {"annualReportExpenseRatio": {"raw": 0.005}}}}]}}),
        ])
        self.assertEqual(len(yahoo.history("AAA")["prices"]), 1)
        self.assertEqual(yahoo.profile("AAA")["expense_ratio"], 0.005)

    def test_missing_adjusted_close_preserves_liquidity_days(self):
        history = Stub().history("AAA")
        dates = [p["date"] for p in history["prices"]][-64:]
        timestamps = [int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()) for day in dates]
        chart = {"chart": {"result": [{
            "meta": {"firstTradeDate": 1641168000}, "timestamp": timestamps,
            "indicators": {
                "quote": [{"close": [10] * 64, "volume": [1000000] + [49000] * 63}],
                "adjclose": [{"adjclose": [10] * 63 + [None]}],
            },
        }]}}
        yahoo = Yahoo()
        yahoo.session.get = Mock(return_value=json.dumps(chart))
        f = {"ticker": "AAA", **yahoo.history("AAA"), **Stub().profile("AAA")}
        self.assertEqual(gate(f), "Under $0.5M avg daily $ volume")
        self.assertEqual(f["dollar_volume"], 490000)
        self.assertEqual(f["prices"][-1]["date"], dates[-1])
        self.assertIsNone(f["prices"][-1]["adjusted_close"])

    def test_issuer_assets_used_when_quote_fallback_fails(self):
        chart = {"chart": {"result": [{
            "meta": {"firstTradeDate": 1641168000},
            "timestamp": [1641168000, 1672704000, 1704240000],
            "indicators": {
                "quote": [{"close": [100, 110, 130], "volume": [100000] * 3}],
                "adjclose": [{"adjclose": [100, 110, 130]}],
            },
        }]}}
        responses = [json.dumps(chart), "", "crumb", json.dumps({"quoteSummary": {"result": [{
            "summaryDetail": {},
            "fundProfile": {"feesExpensesInvestment": {"annualReportExpenseRatio": {"raw": 0.004}}},
        }]}}), urllib.error.URLError("quote endpoint unavailable")]
        with tempfile.TemporaryDirectory() as tmp, patch("pipeline.sources.yahoo.Session.get", side_effect=responses):
            path = Path(tmp)
            with self.assertLogs(level="WARNING") as logs:
                result = run(
                    {"theme": "Photonics & optics", "data_source": "yahoo"},
                    path / "screen.json", path / "cache",
                    "Symbol|Security Name|ETF|Test Issue\nLAZR|Photonics ETF|Y|N\n",
                )
            f = result["funds"][0]
            self.assertEqual(f["net_assets"], 118800000)
            self.assertEqual(f["assets_source"], "issuer website")
            self.assertEqual(f["assets_as_of"], "2026-08-31")
            self.assertEqual(f["expense_ratio"], 0.004)
            self.assertEqual(f["status"], "Eligible")
            self.assertFalse(f["stale"])
            self.assertEqual(result["failed_fetches"], [])
            self.assertIn("quote endpoint unavailable", f["warnings"][0])
            self.assertIn("quote endpoint unavailable", " ".join(logs.output))
            self.assertEqual(json.loads((path / "screen.json").read_text())["funds"][0]["warnings"], f["warnings"])

    def test_quote_errors_preserve_successful_profile_fields(self):
        errors = [
            urllib.error.HTTPError("quote", 503, "unavailable", {}, io.BytesIO()),
            TimeoutError("timed out"),
            "not JSON",
            json.dumps({"quoteResponse": {"result": [], "error": {"description": "unavailable"}}}),
        ]
        for error in errors:
            with self.subTest(error=error):
                yahoo = Yahoo()
                yahoo.crumb = "test"
                yahoo.session.get = Mock(side_effect=[
                    json.dumps({"quoteSummary": {"result": [{"summaryDetail": {}, "fundProfile": {
                        "feesExpensesInvestment": {"annualReportExpenseRatio": {"raw": 0.004}},
                    }}]}}), error,
                ])
                profile = yahoo.profile("AAA")
                self.assertIsNone(profile["net_assets"])
                self.assertEqual(profile["expense_ratio"], 0.004)
                self.assertEqual(len(profile["warnings"]), 1)

    def test_yahoo_net_assets_fallback(self):
        yahoo = Yahoo()
        yahoo.crumb = "test"
        yahoo.session.get = Mock(side_effect=[
            json.dumps({"quoteSummary": {"result": [{"summaryDetail": {}, "fundProfile": {}}]}}),
            json.dumps({"quoteResponse": {"result": [{"netAssets": 30e6}]}}),
        ])
        profile = yahoo.profile("AAA")
        self.assertEqual(profile["net_assets"], 30e6)
        self.assertEqual(profile["assets_source"], "Yahoo netAssets")
        self.assertIsNone(profile["expense_ratio"])


if __name__ == "__main__":
    unittest.main()
