import unittest

from pipeline.holdings import match_companies
from pipeline.stocks import build, listings

DIRECTORY = "\n".join([
    "Nasdaq Traded|Symbol|Security Name|Listing Exchange|Market Category|ETF|Round Lot Size|Test Issue|Financial Status|CQS Symbol|NASDAQ Symbol|NextShares",
    "Y|TSM|Taiwan Semiconductor Manufacturing Company Ltd.|N| |N|100|N||TSM|TSM|N",
    "Y|NVDA|NVIDIA Corporation - Common Stock|Q|Q|N|100|N|N||NVDA|N",
    "Y|SMH|VanEck Semiconductor ETF|P| |Y|100|N||SMH|SMH|N",
    "Y|NET|Cloudflare, Inc. Class A Common Stock|N| |N|40|N||NET|NET|N",
    "Y|AMT|American Tower Corporation (REIT) Common Stock|N| |N|100|N||AMT|AMT|N",
    "Y|BA|Boeing Company (The) Common Stock|N| |N|100|N||BA|BA|N",
    "Y|ERIC|Ericsson - American Depositary Shares each representing 1 underlying Class B share|Q|Q|N|100|N|N||ERIC|N",
    "Y|ZZZW|Zeta Widgets Inc. - Warrant|Q|G|N|100|N|N||ZZZW|N",
])


def fund(ticker, theme, group="Technology", status="Eligible"):
    return {"ticker": ticker, "theme": theme, "group": group, "status": status}


def row(name, weight, **extra):
    return {"name": name, "ticker": extra.pop("ticker", None), "asset_type": "Equity", "weight": weight, **extra}


class StockTests(unittest.TestCase):
    def run_build(self, funds, files):
        match_companies(list(files.values()), [])
        return {s["name"]: s for s in build(funds, files, listings(DIRECTORY))}

    def test_counts_distinct_themes_merges_classes_and_drops_noise(self):
        funds = [fund("A", "Semis"), fund("B", "Semis"), fund("C", "AI"), fund("D", "Multi", group="Broad thematic"),
                 fund("E", "Cloud", status="Under $25M (emerging minimum)")]
        files = {
            "A": {"holdings": [row("NVIDIA Corp", 0.08, location="United States"), row("Alphabet Inc Class A", 0.006),
                               row("Zeta Widgets Inc", 0.02)]},
            "B": {"holdings": [row("NVIDIA CORPORATION", 0.05)]},
            "C": {"holdings": [row("NVIDIA Corp", 0.04), row("Alphabet Inc Class A", 0.006), row("Alphabet Inc Class C", 0.006)]},
            "D": {"holdings": [row("Zeta Widgets Inc", 0.05)]},  # Broad thematic: never counts
            "E": {"holdings": [row("Zeta Widgets Inc", 0.05)]},  # not eligible: never counts
        }
        stocks = self.run_build(funds, files)
        nvidia = stocks["NVIDIA Corp"]
        self.assertEqual((nvidia["themes"], [f["ticker"] for f in nvidia["funds"]]), (["AI", "Semis"], ["A", "B", "C"]))
        self.assertEqual((nvidia["ticker"], nvidia["direct"]), ("NVDA", True))
        self.assertNotIn("Zeta Widgets Inc", stocks)  # one theme only, after Broad thematic and ineligible funds are dropped
        # Alphabet: 0.6% in A is under 1%; in C two share classes sum to 1.2%, but that is still one theme.
        self.assertNotIn("Alphabet Inc Class C", stocks)
        self.assertNotIn("Alphabet Inc Class A", stocks)

    def test_listing_tags(self):
        funds = [fund("A", "Semis"), fund("B", "AI")]
        files = {
            "A": {"holdings": [row("TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD", 0.09, location="Taiwan", ticker="2330"),
                               row("Shopify Inc", 0.03, location="Canada", ticker="SHOP"),
                               row("Samsung Electronics Co Ltd", 0.04, location="Korea (South)"), row("CLOUDFLARE INC - CLASS A", 0.02),
                               row("AMERICAN TOWER CORP", 0.02, ticker="AMT US"), row("BAE Systems PLC", 0.02, ticker="BA", location="United Kingdom"),
                               row("Telefonaktiebolaget LM Ericsson", 0.02, ticker="ERIC US", location="Sweden")]},
            "B": {"holdings": [row("Taiwan Semiconductor Manufacturing", 0.05, location="Taiwan"),
                               row("Shopify Inc", 0.02, location="Canada"),
                               row("SAMSUNG ELECTRONICS CO LTD", 0.03, location="South Korea"), row("Cloudflare Inc", 0.02),
                               row("American Tower Corporation", 0.02), row("BAE SYSTEMS PLC", 0.02),
                               row("Telefonaktiebolaget Lm Ericsson", 0.02)]},
        }
        stocks = self.run_build(funds, files)
        tsmc = stocks["TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD"]
        self.assertEqual((tsmc["ticker"], tsmc["direct"]), ("TSM", True))  # ADR, matched by name
        self.assertTrue(stocks["Shopify Inc"]["direct"])
        self.assertEqual(stocks["AMERICAN TOWER CORP"]["ticker"], "AMT")  # name differs ("(REIT)"); matched by ticker
        self.assertFalse(stocks["BAE Systems PLC"]["direct"])
        self.assertEqual(stocks["Telefonaktiebolaget LM Ericsson"]["ticker"], "ERIC")  # shares the word "ericsson"  # UK ticker BA is not NYSE BA (Boeing)
        cloudflare = stocks["CLOUDFLARE INC - CLASS A"]  # NYSE-style directory name, no country in the holdings
        self.assertEqual((cloudflare["ticker"], cloudflare["direct"]), ("NET", True))
        samsung = stocks["Samsung Electronics Co Ltd"]  # two Korea spellings still one company
        self.assertEqual((samsung["direct"], len(samsung["funds"])), (False, 2))

    def test_order_themes_then_funds_then_weight(self):
        funds = [fund("A", "T1"), fund("B", "T2"), fund("C", "T3"), fund("D", "T1")]
        files = {"A": {"holdings": [row("Big", 0.02), row("Wide", 0.02), row("Deep", 0.05)]},
                 "B": {"holdings": [row("Big", 0.02), row("Wide", 0.02), row("Deep", 0.05)]},
                 "C": {"holdings": [row("Big", 0.02), row("Wide", 0.03)]},
                 "D": {"holdings": [row("Big", 0.02)]}}
        self.assertEqual([s["name"] for s in build(funds, (match_companies(list(files.values()), []), files)[1], listings(""))],
                         ["Big", "Wide", "Deep"])  # Big and Wide: 3 themes, Big has 4 funds; Deep: 2 themes


if __name__ == "__main__":
    unittest.main()
