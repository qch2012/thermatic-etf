import csv
from datetime import datetime
import io


def parse_ishares(text):
    """iShares `latest-holdings.csv`: a few header lines, then a table starting at `Ticker,Name,...`."""
    lines = text.splitlines()
    as_of = next(row[1] for row in csv.reader(lines[:5]) if row and row[0] == "Fund Holdings as of")
    start = next(i for i, line in enumerate(lines) if line.startswith("Ticker,"))

    def weight(row):
        # Some funds publish "Market Weight" (share of net assets) and "Notional Weight" instead of "Weight (%)";
        # there futures show "-" (no market value), which the other layout prints as 0.00.
        text = (row.get("Weight (%)") or row["Market Weight"]).replace(",", "")
        return 0.0 if text == "-" else round(float(text) / 100, 10)

    holdings = []
    for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        if not row["Name"]:
            continue
        holding = {"name": row["Name"], "ticker": row["Ticker"], "asset_type": row["Asset Class"], "weight": weight(row)}
        if row["Location"] not in ("", "-"):
            holding["location"] = row["Location"]  # country of the issuer; used to stop false name matches
        holdings.append(holding)
    return {"as_of": datetime.strptime(as_of, "%b %d, %Y").date().isoformat(), "holdings": holdings}
