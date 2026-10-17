from datetime import datetime, timezone
import json
import math
import urllib.error
from urllib.parse import quote, urlencode

from .http import Session


def raw(value):
    return value.get("raw") if isinstance(value, dict) else value


def day(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()


class Yahoo:
    def __init__(self):
        self.session = Session()
        self.crumb = None

    def history(self, ticker):
        data = json.loads(self.session.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(ticker, safe='')}?range=5y&interval=1d"
        ))["chart"]
        if data.get("error"):
            raise ValueError(str(data["error"]))
        result = data["result"][0]
        quotes = result["indicators"]["quote"][0]
        adjusted = result["indicators"]["adjclose"][0]["adjclose"]
        prices = []
        for i, timestamp in enumerate(result.get("timestamp", [])):
            close, adj, volume = quotes["close"][i], adjusted[i], quotes["volume"][i]
            if all(isinstance(v, (int, float)) and math.isfinite(v) for v in (close, volume)) and close > 0 and volume >= 0:
                if not (isinstance(adj, (int, float)) and math.isfinite(adj) and adj > 0):
                    adj = None
                prices.append(dict(date=day(timestamp), close=close, adjusted_close=adj, volume=volume))
        return {"first_trade_date": day(result["meta"]["firstTradeDate"]), "prices": prices}

    def profile(self, ticker):
        if self.crumb is None:
            try:
                self.session.get("https://fc.yahoo.com")
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
            self.crumb = self.session.get("https://query1.finance.yahoo.com/v1/test/getcrumb").strip()
            if not self.crumb or "<" in self.crumb:
                raise ValueError("Invalid Yahoo crumb")
        query = urlencode({"modules": "summaryDetail,fundProfile,price", "crumb": self.crumb})
        data = json.loads(self.session.get(
            f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{quote(ticker, safe='')}?{query}"
        ))["quoteSummary"]
        if data.get("error") or not data.get("result"):
            raise ValueError(f"Yahoo profile unavailable: {ticker}")
        result = data["result"][0]
        assets = raw(result.get("summaryDetail", {}).get("totalAssets"))
        source = "Yahoo totalAssets"
        warnings = []
        if assets is None:
            source = "Yahoo netAssets"
            try:
                quote_data = json.loads(self.session.get(
                    "https://query1.finance.yahoo.com/v7/finance/quote?" + urlencode({"symbols": ticker, "crumb": self.crumb})
                ))["quoteResponse"]
                if quote_data.get("error"):
                    raise ValueError(str(quote_data["error"]))
                rows = quote_data.get("result") or []
                assets = raw(rows[0].get("netAssets")) if rows else None
            except (urllib.error.URLError, TimeoutError, ValueError) as error:
                if isinstance(error, urllib.error.HTTPError):
                    error.close()
                warnings.append(f"Yahoo netAssets fallback failed: {error}")
        fee = raw(result.get("fundProfile", {}).get("feesExpensesInvestment", {}).get("annualReportExpenseRatio"))
        for value in (assets, fee):
            if value is not None and (not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0):
                raise ValueError(f"Invalid Yahoo profile number: {ticker}")
        return {"net_assets": assets, "expense_ratio": fee, "assets_source": source, "warnings": warnings}
