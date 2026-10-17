from datetime import date, timedelta
import math
import os
import zlib


class Stub:
    """Deterministic synthetic data; never presented as real market data."""

    def history(self, ticker):
        # STUB_FAIL_RATE (e.g. 0.2) makes that share of tickers fail, to test the refresh checks.
        if zlib.crc32(ticker.encode()) % 100 < float(os.environ.get("STUB_FAIL_RATE", 0)) * 100:
            raise RuntimeError(f"{ticker}: simulated adapter failure")
        prices = []
        seed = sum(map(ord, ticker))
        for i in range(1462):
            day = date(2022, 1, 3) + timedelta(days=i)
            if day.weekday() < 5:
                price = 100 * math.exp(i * (0.0001 + seed % 7 * 0.00002) + 0.01 * math.sin(i))
                prices.append(dict(date=day.isoformat(), close=price, adjusted_close=price, volume=100000))
        return {"first_trade_date": "2022-01-03", "prices": prices}

    def profile(self, ticker):
        seed = sum(map(ord, ticker))
        return {"net_assets": (100 + seed) * 1e6, "expense_ratio": (seed % 50 + 5) / 10000, "assets_source": "SYNTHETIC stub"}
