from datetime import date, timedelta
import math


class Stub:
    """Deterministic synthetic data; never presented as real market data."""

    def history(self, ticker):
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
