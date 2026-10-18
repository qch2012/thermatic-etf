import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import yaml

from pipeline.__main__ import ROOT, run, write_json
from pipeline.sources.stub import Stub
from pipeline.holdings import match_companies, normalize, refresh, top_holdings
from pipeline.sources.issuers import PARSERS
from pipeline.sources.issuers.ishares import parse_ishares
from pipeline.sources.issuers.select import parse_select
from pipeline.sources.issuers.themes import parse_themes

FIXTURES = ROOT / "tests/fixtures"
DIRECTORY = "Symbol|Security Name|ETF|Test Issue\nAAA|Example Semiconductor ETF|Y|N\nBBB|Other Chip ETF|Y|N\n"


class ParserTests(unittest.TestCase):
    def test_ishares_file_with_type_column(self):
        # Real file downloaded 2026-10-17 from the IDEF fund page (layout with a "Type" column).
        parsed = parse_ishares((FIXTURES / "ishares_IDEF_2026-10-15.csv").read_text(encoding="utf-8-sig"))
        self.assertEqual(parsed["as_of"], "2026-10-15")
        rows = parsed["holdings"]
        self.assertEqual(len(rows), 168)
        self.assertEqual(rows[0], {"name": "RTX", "ticker": "RTX", "asset_type": "Equity", "weight": 0.0522, "location": "United States"})
        airbus = next(r for r in rows if r["name"] == "AIRBUS GROUP")
        self.assertEqual((airbus["ticker"], airbus["weight"], airbus["location"]), ("AIR", 0.0211, "France"))
        # Cash and futures rows are kept as published, with their asset type.
        self.assertEqual(rows[-1], {"name": "S&P500 EMINI DEC 26", "ticker": "ESZ6", "asset_type": "Futures", "weight": 0.0})
        self.assertIn({"name": "EUR CASH", "ticker": "EUR", "asset_type": "Cash", "weight": 0.0, "location": "European Union"}, rows)

    def test_ishares_file_without_type_column(self):
        parsed = parse_ishares((FIXTURES / "ishares_ITA_2026-10-15.csv").read_text(encoding="utf-8-sig"))
        self.assertEqual(parsed["as_of"], "2026-10-15")
        self.assertEqual(parsed["holdings"][0], {"name": "GE AEROSPACE", "ticker": "GE", "asset_type": "Equity", "weight": 0.2096, "location": "United States"})
        self.assertEqual(parsed["holdings"][-1]["asset_type"], "Futures")
        self.assertEqual(len(parsed["holdings"]), 54)

    def test_ishares_file_with_market_and_notional_weight(self):
        # IFRA layout: "Market Weight" (share of net assets, what SPEC 4.1 wants) and "Notional Weight", no "Weight (%)".
        parsed = parse_ishares((FIXTURES / "ishares_IFRA_2026-10-15.csv").read_text(encoding="utf-8-sig"))
        self.assertEqual(parsed["holdings"][0], {"name": "UNION PACIFIC", "ticker": "UNP", "asset_type": "Equity", "weight": 0.0416, "location": "United States"})
        self.assertEqual(len(parsed["holdings"]), 168)

    def test_themes_csv_splits_cusip_and_sedol_and_skips_placeholders(self):
        # Real NATO file downloaded 2026-10-17. Its `date` (2026-10-19, a Monday) is the next trade date: holdings are as of Friday.
        parsed = parse_themes((FIXTURES / "themes_NATO_2026-10-17.csv").read_text(encoding="utf-8-sig"))
        self.assertEqual(parsed["as_of"], "2026-10-16")
        rows = {r["name"]: r for r in parsed["holdings"]}
        self.assertEqual(len(parsed["holdings"]), 98)
        self.assertEqual(rows["AIRBUS GROUP SE"], {"name": "AIRBUS GROUP SE", "ticker": "AIR FP", "asset_type": "Equity", "weight": 0.0663, "sedol": "4012250", "location": "France"})
        self.assertEqual(rows["Archer Aviation Inc"]["cusip"], "03945R102")
        self.assertNotIn("sedol", rows["Archer Aviation Inc"])
        for name in ("EURO", "Cash & Other", "First American Treasury Obligations Fund 01/01/2040"):
            self.assertNotEqual(rows[name]["asset_type"], "Equity")
        for r in parsed["holdings"]:
            self.assertFalse({"cusip", "sedol", "isin"} & set(r) and r["asset_type"] != "Equity", r)
            for field in ("cusip", "sedol"):
                self.assertTrue(field not in r or (r[field].isalnum() and not r[field].startswith("CASH")), r)

    def test_select_json(self):
        # Real EUAD data from the Select Funds API, 2026-10-17. Weights are percents; the API has no asset class or country.
        parsed = parse_select((FIXTURES / "select_EUAD_2026-10-17.json").read_text())
        self.assertEqual(parsed["as_of"], "2026-10-15")
        self.assertEqual(len(parsed["holdings"]), 22)
        self.assertEqual(parsed["holdings"][1], {"name": "SAFRAN SA-UNSPON ADR", "ticker": "SAFRY", "asset_type": "Equity", "weight": 0.19359, "cusip": "786584102"})
        self.assertAlmostEqual(sum(h["weight"] for h in parsed["holdings"]), 1.0, places=3)

    def test_real_nato_and_euad_share_airbus_and_bae(self):
        files = [{"holdings": parse_themes((FIXTURES / "themes_NATO_2026-10-17.csv").read_text())["holdings"]},
                 {"holdings": parse_select((FIXTURES / "select_EUAD_2026-10-17.json").read_text())["holdings"]}]
        match_companies(files, [])
        nato, euad = ({h["name"]: h["company"] for h in f["holdings"]} for f in files)
        self.assertEqual(nato["AIRBUS GROUP SE"], euad["AIRBUS GROUP SE"])
        self.assertEqual(nato["BAE Systems PLC"], euad["BAE SYSTEMS PLC -SPON ADR"])


def row(name, weight, **ids):
    return {"name": name, "ticker": None, "asset_type": ids.pop("asset_type", "Equity"), "weight": weight, **ids}


# Rows as published on 2026-10-17: NATO (Themes CSV) holds local listings, EUAD (Select / Tuttle) holds ADRs.
NATO = {"ticker": "NATO", "holdings": [row("AIRBUS GROUP SE", 0.0663, sedol="4012250", location="France"), row("BAE Systems PLC", 0.0415, sedol="0263494", location="United Kingdom"),
                                       row("LEONARDO-FINMECCANICA SPA", 0.0119), row("Astronics Corp", 0.0009), row("Astronics Corp", 0.0002),
                                       row("Boeing Co/The", 0.0728), row("EURO", 0.0, asset_type="Cash")]}
EUAD = {"ticker": "EUAD", "holdings": [row("AIRBUS GROUP SE", 0.181428, cusip="N0280G100"), row("BAE SYSTEMS PLC -SPON ADR", 0.107434, cusip="05523R107"),
                                       row("Leonardo SpA", 0.036448), row("SAFRAN SA-UNSPON ADR", 0.19359)]}


class MatchingTests(unittest.TestCase):
    def keys(self, *files, aliases=()):
        match_companies(files, list(aliases))
        return [{h["name"]: h["company"] for h in f["holdings"]} for f in files]

    def test_local_listing_and_adr_are_one_company(self):
        nato, euad = self.keys(NATO, EUAD)
        self.assertEqual(nato["BAE Systems PLC"], euad["BAE SYSTEMS PLC -SPON ADR"])
        self.assertEqual(nato["AIRBUS GROUP SE"], euad["AIRBUS GROUP SE"])
        self.assertNotEqual(nato["Boeing Co/The"], euad["SAFRAN SA-UNSPON ADR"])
        self.assertIsNone(nato["EURO"])  # non-equity rows are left out of matching

    def test_identifier_then_alias(self):
        a = {"ticker": "A", "holdings": [row("Alphabet Inc Class A", 0.1, isin="US02079K3059")]}
        b = {"ticker": "B", "holdings": [row("GOOGLE", 0.1, isin="US02079K3059")]}
        (ka,), (kb,) = (list(k.values()) for k in self.keys(a, b))
        self.assertEqual(ka, kb)
        nato, euad = self.keys(NATO, EUAD)
        self.assertNotEqual(nato["LEONARDO-FINMECCANICA SPA"], euad["Leonardo SpA"])
        nato, euad = self.keys(NATO, EUAD, aliases=[{"names": ["Leonardo SpA", "Leonardo-Finmeccanica SpA"]}])
        self.assertEqual(nato["LEONARDO-FINMECCANICA SPA"], euad["Leonardo SpA"])

    def test_same_name_in_different_countries_is_not_merged(self):
        # Siemens AG (Germany) and Siemens Ltd (its separately listed Indian subsidiary) both normalize to "siemens".
        de = {"ticker": "DE", "holdings": [row("Siemens AG", 0.05, isin="DE0007236101", location="Germany")]}
        india = {"ticker": "IN", "holdings": [row("Siemens Ltd", 0.04, isin="INE003A01024", location="India")]}
        bare = {"ticker": "X", "holdings": [row("SIEMENS", 0.01)]}  # no location: ambiguous, so merged with neither
        k_de, k_in, k_bare = (k[n] for k, n in zip(self.keys(de, india, bare), ("Siemens AG", "Siemens Ltd", "SIEMENS")))
        self.assertEqual(len({k_de, k_in, k_bare}), 3)

    def test_good_merges_survive_the_location_check(self):
        pairs = [
            (row("ALPHABET INC CLASS A", 0.04, isin="US02079K3059", location="United States"),
             row("ALPHABET INC CLASS C", 0.03, isin="US02079K1079", location="United States")),
            (row("TAIWAN SEMICONDUCTOR MANUFACTURING ADR", 0.08, location="Taiwan"),
             row("TAIWAN SEMICONDUCTOR MANUFACTURING", 0.09, location="Taiwan")),
            (row("Saab AB", 0.0106, sedol="BPXZH27", location="Sweden"), row("SAAB B", 0.01, location="Sweden")),
            (row("BAE Systems PLC", 0.0415, sedol="0263494", location="United Kingdom"),
             row("BAE SYSTEMS PLC -SPON ADR", 0.107434, cusip="05523R107")),  # EUAD publishes no country
        ]
        for a, b in pairs:
            ka, kb = self.keys({"ticker": "A", "holdings": [a]}, {"ticker": "B", "holdings": [b]})
            self.assertEqual(ka[a["name"]], kb[b["name"]], (a["name"], b["name"]))

    def test_never_merge_list(self):
        a = {"ticker": "A", "holdings": [row("Siemens AG", 0.05)]}
        b = {"ticker": "B", "holdings": [row("Siemens Ltd", 0.04)]}
        ka, kb = self.keys(a, b)  # no location data: names alone merge them
        self.assertEqual(ka["Siemens AG"], kb["Siemens Ltd"])
        match_companies([a, b], [], [{"names": ["Siemens AG", "Siemens Ltd"]}])
        self.assertNotEqual(a["holdings"][0]["company"], b["holdings"][0]["company"])

    def test_normalized_names(self):
        for a, b in [("PALANTIR TECHNOLOGIES CLASS A", "Palantir Technologies Inc"), ("Avio S.p.A.", "Avio SpA"),
                     ("TKMS AG+ CO KGAA NPV", "TKMS"), ("VIRGIN GALACTIC HOLDINGS INC SHS C", "Virgin Galactic Holdings Inc"),
                     ("ROLLS-ROYCE HOLDINGS-SP ADR", "Rolls-Royce Holdings PLC")]:
            self.assertEqual(normalize(a), normalize(b), (a, b))
        self.assertNotEqual(normalize("Rolls-Royce Holdings PLC"), normalize("Royce Holdings"))

    def test_top_holdings_sum_share_classes(self):
        match_companies([NATO], [])
        self.assertEqual(top_holdings(NATO), [{"name": "Boeing Co/The", "weight": 0.0728}, {"name": "AIRBUS GROUP SE", "weight": 0.0663},
                                              {"name": "BAE Systems PLC", "weight": 0.0415}])
        small = {"ticker": "S", "holdings": [row("Astronics Corp", 0.0009), row("Astronics Corp", 0.0002), row("X Inc", 0.001), row("Cash", 0.5, asset_type="Cash")]}
        match_companies([small], [])
        self.assertEqual(top_holdings(small), [{"name": "Astronics Corp", "weight": 0.0011}, {"name": "X Inc", "weight": 0.001}])


class RefreshTests(unittest.TestCase):
    def test_writes_files_fills_top_holdings_and_reuses_last_good(self):
        idef_url, ita_url = "https://issuer.test/idef.csv", "https://issuer.test/ita.csv"
        sources = {"IDEF": {"parser": "ishares", "url": idef_url}, "ITA": {"parser": "ishares", "url": ita_url},
                   "OFF": {"parser": "ishares", "url": "https://issuer.test/off.csv"}}
        texts = {idef_url: (FIXTURES / "ishares_IDEF_2026-10-15.csv").read_text(encoding="utf-8-sig"),
                 ita_url: (FIXTURES / "ishares_ITA_2026-10-15.csv").read_text(encoding="utf-8-sig")}
        requested = []

        def get(url):
            requested.append(url)
            return texts[url]

        funds = [{"ticker": "IDEF", "status": "Eligible"}, {"ticker": "ITA", "status": "Eligible"},
                 {"ticker": "NOSRC", "status": "Eligible"}, {"ticker": "OFF", "status": "Under $0.5M avg daily $ volume"}]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            refresh(funds, out, sources, [], get, write_json)
            self.assertEqual(requested, [idef_url, ita_url])  # only eligible funds with a source are fetched
            self.assertEqual(sorted(p.name for p in out.iterdir()), ["IDEF.json", "ITA.json"])
            idef = json.loads((out / "IDEF.json").read_text())
            self.assertEqual((idef["ticker"], idef["as_of"], idef["source"], idef["stale"]), ("IDEF", "2026-10-15", idef_url, False))
            self.assertEqual(len(idef["holdings"]), 168)  # every published row kept, cash and futures included
            self.assertEqual(funds[0]["top_holdings"], [{"name": "RTX", "weight": 0.0522}, {"name": "PALANTIR TECHNOLOGIES CLASS A", "weight": 0.0447},
                                                        {"name": "LOCKHEED MARTIN CORP", "weight": 0.0353}])
            self.assertEqual(funds[1]["top_holdings"][0], {"name": "GE AEROSPACE", "weight": 0.2096})
            # RTX is in both funds: same company key in both files.
            ita = json.loads((out / "ITA.json").read_text())
            key = lambda f: next(h["company"] for h in f["holdings"] if h["name"] == "RTX")
            self.assertEqual(key(idef), key(ita))
            self.assertNotIn("top_holdings", funds[2])  # no source: site shows "full holdings unavailable"

            def broken(url):
                if url == ita_url:
                    raise OSError("HTTP 503")
                return texts[url]
            funds = [{"ticker": "IDEF", "status": "Eligible"}, {"ticker": "ITA", "status": "Eligible"}]
            refresh(funds, out, sources, [], broken, write_json)
            ita = json.loads((out / "ITA.json").read_text())
            self.assertEqual((ita["stale"], ita["as_of"]), (True, "2026-10-15"))
            self.assertEqual(funds[1]["top_holdings"][0], {"name": "GE AEROSPACE", "weight": 0.2096})
            (out / "ITA.json").unlink()
            funds = [{"ticker": "ITA", "status": "Eligible"}]
            refresh(funds, out, sources, [], broken, write_json)  # no last good file: no holdings, no error
            self.assertNotIn("top_holdings", funds[0])
            self.assertFalse((out / "ITA.json").exists())

    def test_malformed_last_good_file_is_skipped(self):
        sources = {"ITA": {"parser": "ishares", "url": "https://issuer.test/ita.csv"},
                   "IDEF": {"parser": "ishares", "url": "https://issuer.test/idef.csv"}}
        idef = (FIXTURES / "ishares_IDEF_2026-10-15.csv").read_text(encoding="utf-8-sig")

        def get(url):
            if "ita" in url:
                raise OSError("HTTP 503")
            return idef
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            for bad in ("not json", '{"ticker": "ITA"}'):  # unparsable, and parsable but no holdings
                (out / "ITA.json").write_text(bad)
                funds = [{"ticker": "ITA", "status": "Eligible"}, {"ticker": "IDEF", "status": "Eligible"}]
                with self.assertLogs(level="WARNING"):
                    refresh(funds, out, sources, [], get, write_json)
                self.assertNotIn("top_holdings", funds[0])
                self.assertEqual(funds[1]["top_holdings"][0], {"name": "RTX", "weight": 0.0522})

    def test_bad_config_never_blocks_publishing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "bad.yaml").write_text("ITA: [unclosed\n")
            with patch("pipeline.holdings.SOURCES", path / "bad.yaml"), patch("pipeline.__main__.create", return_value=Stub()), \
                    self.assertLogs(level="WARNING") as logs:
                result = run({"data_source": "yahoo"}, path / "screen.json", path / "cache", DIRECTORY)
            self.assertTrue((path / "screen.json").exists())
            self.assertTrue(result["funds"])
            self.assertFalse(any("top_holdings" in f for f in result["funds"]))
            self.assertTrue(any("holdings" in line for line in logs.output), logs.output)

    def test_config_parsers_exist(self):
        sources = yaml.safe_load((ROOT / "config/holdings_sources.yaml").read_text())
        links = json.loads((ROOT / "config/issuer_links.json").read_text())
        for ticker, source in sources.items():
            self.assertIn(source["parser"], PARSERS, ticker)
            self.assertTrue(source["url"].startswith("https://"), ticker)
        self.assertTrue(all("ishares.com" in links[t] for t, s in sources.items() if s["parser"] == "ishares"))
        overrides = yaml.safe_load((ROOT / "config/holding_aliases.yaml").read_text())
        self.assertEqual(set(overrides), {"aliases", "never_merge"})
        for entry in overrides["aliases"] + overrides["never_merge"]:
            self.assertTrue(entry["reason"] and len(entry["names"]) >= 2, entry)


if __name__ == "__main__":
    unittest.main()
