from datetime import date
from pathlib import Path
import tempfile
import unittest

from pipeline.report import build_report, load_baseline

TODAY = date(2026, 10, 17)
TAXONOMY = {
    "exclude_name_regex": r"\bbull\b|blue ?chip",
    "exclude_tickers": ["XXXX"],
    "overrides": {"OVRD": "Cloud computing"},
    "themes": [
        {"group": "Technology", "theme": "Semiconductors", "match": r"semiconductor|\bchip"},
        {"group": "Technology", "theme": "Cloud computing", "match": r"\bcloud"},
        {"group": "Technology", "theme": "Cybersecurity", "match": r"cyber"},
    ],
}


def directory(*rows):
    return [{"ticker": t, "name": n} for t, n in rows]


def screen(funds=(), themes=(), missing=()):
    return {"funds": list(funds), "themes": [{"theme": t, "eligible": e} for t, e in themes],
            "missing_issuer_links": list(missing)}


def report(rows, baseline=None, scr=None, overrides=None, holdings=None, today=TODAY):
    baseline = baseline or {"label": "none", "full": True, "tickers": {}}
    return build_report(directory(*rows), TAXONOMY, scr or screen(), baseline, overrides or {}, holdings, today)


def section(text, title):
    start = text.index("## " + title)
    end = text.find("\n## ", start + 1)
    return text[start:end if end != -1 else None]


class NewFundsTests(unittest.TestCase):
    def test_new_funds_split_into_classified_excluded_unclassified(self):
        base = {"label": "b", "full": True, "tickers": {"OLD": {"name": "Old Chip ETF", "theme": "Semiconductors"}}}
        text = report([("OLD", "Old Chip ETF"), ("NEWC", "New Cloud ETF"), ("NEWX", "Big Blue Chip Fund"), ("NEWU", "Plain Fund")], base)
        new = section(text, "New ETFs since last re-screen")
        self.assertIn("NEWC", new.split("Excluded")[0])
        self.assertIn("Cloud computing", new)
        self.assertIn("NEWX", new.split("Excluded")[1].split("Unclassified")[0])
        self.assertIn("NEWU", new.split("Unclassified")[1])
        self.assertNotIn("OLD", new)

    def test_seed_style_baseline_cannot_list_unclassified(self):
        base = {"label": "seed", "full": False, "tickers": {}}
        new = section(report([("NEWC", "New Cloud ETF"), ("NEWU", "Plain Fund")], base), "New ETFs since last re-screen")
        self.assertIn("NEWC", new)
        self.assertNotIn("NEWU", new)
        self.assertIn("classified funds only", new)

    def test_delisted(self):
        base = {"label": "b", "full": True, "tickers": {"GONE": {"name": "Gone Chip ETF", "theme": "Semiconductors"}}}
        self.assertIn("GONE", section(report([("AAA", "Some Fund")], base), "Delisted funds"))


class CandidateTests(unittest.TestCase):
    def test_possible_miss_only_for_unclassified_not_excluded(self):
        text = report([("INNO", "Acme Innovation ETF"), ("BULL", "Next Bull ETF"), ("PLN", "Plain Fund")])
        misses = section(text, "Possible misses")
        self.assertIn("INNO", misses)
        self.assertNotIn("BULL", misses)
        self.assertNotIn("PLN", misses)

    def test_possible_false_positive(self):
        text = report([("LGC", "Large Cap Chip Core ETF"), ("OK", "Semiconductor ETF")])
        fp = section(text, "Possible false positives")
        self.assertIn("LGC", fp)
        self.assertNotIn("OK", fp)

    def test_multi_theme_names(self):
        text = report([("MUL", "Cloud Cybersecurity ETF"), ("ONE", "Cloud ETF")])
        multi = section(text, "Multi-theme name matches")
        self.assertIn("MUL", multi)
        self.assertIn("Cloud computing", multi)
        self.assertIn("Cybersecurity", multi)
        self.assertNotIn("ONE", multi)

    def test_override_is_not_multi_theme(self):
        self.assertNotIn("OVRD", section(report([("OVRD", "Cloud Cyber ETF")]), "Multi-theme name matches"))


class ThemeSizeTests(unittest.TestCase):
    def test_small_and_large_themes(self):
        scr = screen(themes=[("Semiconductors", 20), ("Cloud computing", 1)])
        sizes = section(report([], scr=scr), "Theme sizes")
        self.assertIn("Cybersecurity (0)", sizes)
        self.assertIn("Cloud computing (1)", sizes)
        self.assertIn("Semiconductors (20)", sizes.split("more than 15")[1])


class HousekeepingTests(unittest.TestCase):
    def test_missing_links_and_old_overrides(self):
        ov = {"DISK": {"as_of": "2026-08-31"}, "NEW": {"as_of": "2026-10-10"}}
        text = report([], scr=screen(missing=["AAA", "BBB"]), overrides=ov)
        self.assertIn("AAA, BBB", section(text, "Missing issuer links"))
        old = section(text, "Net-asset overrides older than 45 days")
        self.assertIn("DISK", old)
        self.assertIn("47 days", old)
        self.assertNotIn("NEW", old)


class HoldingsTests(unittest.TestCase):
    ELIGIBLE = screen(funds=[{"ticker": "AAA", "status": "Eligible"}, {"ticker": "BBB", "status": "Eligible"},
                             {"ticker": "CCC", "status": "Under $25M"}])

    def test_not_yet_available_when_no_files(self):
        text = report([], scr=self.ELIGIBLE, holdings=None)
        self.assertIn("holdings not yet available", section(text, "Holdings"))

    def test_gaps_stale_and_alias_candidates(self):
        files = {
            "AAA": {"as_of": "2026-10-01", "stale": False, "holdings": [
                {"name": "Taiwan Semiconductor Manufacturing Co Ltd", "ticker": "2330", "asset_type": "Equity", "weight": 0.1}]},
            "ZZZ": {"as_of": "2026-10-16", "stale": True, "holdings": [
                {"name": "Taiwan Semiconductor Manufacturing Company", "ticker": None, "asset_type": "Equity", "weight": 0.1},
                {"name": "Taiwan Semiconductor Manufacturing Co Ltd", "ticker": "TSM", "asset_type": "Equity", "weight": 0.1},
                {"name": "US Dollar", "ticker": None, "asset_type": "Cash", "weight": 0.01}]},
        }
        h = section(report([], scr=self.ELIGIBLE, holdings=files), "Holdings")
        self.assertIn("BBB", h.split("Stale")[0])
        self.assertNotIn("CCC", h)
        self.assertIn("AAA", h.split("Stale")[1].split("Alias")[0])
        self.assertIn("ZZZ", h.split("Stale")[1].split("Alias")[0])
        alias = h.split("Alias")[1]
        self.assertIn("Taiwan Semiconductor Manufacturing Company", alias)
        self.assertNotIn("US Dollar", alias)


class BaselineTests(unittest.TestCase):
    def test_latest_saved_universe_before_today_else_seed(self):
        with tempfile.TemporaryDirectory() as tmp:
            reports, seed = Path(tmp, "r"), Path(tmp, "s")
            reports.mkdir()
            seed.mkdir()
            (seed / "universe_2026-10-06.csv").write_text("ticker,name,group,theme\nSEED,Seed Fund,G,Cloud computing\n")
            base = load_baseline(reports, seed, TODAY)
            self.assertEqual((base["full"], list(base["tickers"])), (False, ["SEED"]))
            head = "ticker,name,outcome,theme\n"
            for day, ticker in (("10", "OLD"), ("14", "MID"), ("17", "SAME")):
                (reports / f"rescreen-2026-10-{day}.universe.csv").write_text(head + f"{ticker},x,unclassified,\n")
            base = load_baseline(reports, seed, TODAY)
            self.assertEqual((base["full"], list(base["tickers"])), (True, ["MID"]))


if __name__ == "__main__":
    unittest.main()
