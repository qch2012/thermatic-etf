from datetime import date
import math
import re
import statistics


def classify(ticker, name, config):
    if ticker in config["exclude_tickers"] or re.search(config["exclude_name_regex"], name, re.I):
        return None
    if ticker in config["overrides"]:
        return config["overrides"][ticker]
    return next((rule["theme"] for rule in config["themes"] if re.search(rule["match"], name, re.I)), None)


def gate(fund):
    prices = fund["prices"]
    if not prices:
        return "No price data"
    fund["age"] = (date.fromisoformat(prices[-1]["date"]) - date.fromisoformat(fund["first_trade_date"])).days / 365.25
    fund["dollar_volume"] = statistics.mean(p["close"] * p["volume"] for p in prices[-63:])
    if fund["net_assets"] is None:
        return "No net-asset data"
    established = fund["age"] >= 3
    if fund["net_assets"] < (100e6 if established else 25e6):
        return "Under $100M (established minimum)" if established else "Under $25M (emerging minimum)"
    if fund["dollar_volume"] < 0.5e6:
        return "Under $0.5M avg daily $ volume"
    return "Eligible"


def percentiles(values, lower_better=False):
    result = {}
    for ticker, value in values.items():
        worse = sum(other > value if lower_better else other < value for other in values.values())
        tied = sum(other == value for other in values.values())
        result[ticker] = (worse + (tied + 1) / 2) / len(values)
    return result


def score(funds):
    for fund in funds:
        fund["status"] = gate(fund)
        fund.update(cumulative_return=None, annualized_return=None, volatility=None, ratio=None, rank=None, score=None)
        fund["new"] = "age" in fund and fund["age"] < 0.5  # age is unknown without price data
    eligible = [f for f in funds if f["status"] == "Eligible"]
    measured = [f for f in eligible if f["age"] >= 0.5]
    window = None
    if measured:
        common = set.intersection(*({p["date"] for p in f["prices"] if p["adjusted_close"] is not None} for f in measured))
        if common:
            end = date.fromisoformat(max(common))
            # Calendar years, including the leap-day anniversary.
            try:
                three_years_ago = end.replace(year=end.year - 3)
            except ValueError:
                three_years_ago = end.replace(year=end.year - 3, day=28)
            start = max(three_years_ago.isoformat(), *(f["first_trade_date"] for f in measured))
            dates = sorted(d for d in common if start <= d <= end.isoformat())
            length = (end - date.fromisoformat(dates[0])).days / 365.25 if dates else 0
            if length >= 0.5:
                window = {"start": dates[0], "end": dates[-1], "years": length, "observations": len(dates)}
                for fund in measured:
                    prices = {p["date"]: p["adjusted_close"] for p in fund["prices"]}
                    aligned = [prices[d] for d in dates]
                    total = aligned[-1] / aligned[0]
                    annualized = total ** (1 / length) - 1
                    returns = [math.log(b / a) for a, b in zip(aligned, aligned[1:])]
                    volatility = statistics.stdev(returns) * math.sqrt(252) if len(returns) > 1 else 0
                    fund.update(cumulative_return=total - 1, annualized_return=annualized, volatility=volatility,
                                ratio=annualized / volatility if volatility > 0 else None)
    sizes = percentiles({f["ticker"]: f["net_assets"] for f in eligible})
    costs = percentiles({f["ticker"]: f["expense_ratio"] for f in eligible if f["expense_ratio"] is not None}, True)
    performance = percentiles({f["ticker"]: f["ratio"] for f in measured if f["ratio"] is not None})
    for fund in eligible:
        ticker = fund["ticker"]
        fund["percentiles"] = {"size": sizes[ticker], "cost": costs.get(ticker, 0.5), "performance": performance.get(ticker, 0.5)}
        fund["performance_unmeasured"] = ticker not in performance
        fund["score"] = 100 * (0.4 * sizes[ticker] + 0.2 * costs.get(ticker, 0.5) + 0.4 * performance.get(ticker, 0.5))
    for rank, fund in enumerate(sorted(eligible, key=lambda f: (-f["score"], -f["net_assets"], f["ticker"])), 1):
        fund["rank"] = rank
    return window
