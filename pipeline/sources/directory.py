import csv
import io
import re

URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt"


def parse(text):
    reader = csv.DictReader(io.StringIO(text), delimiter="|")
    if not {"Symbol", "Security Name", "ETF", "Test Issue"} <= set(reader.fieldnames or []):
        raise ValueError("Unexpected Nasdaq directory columns")
    funds = [
        {"ticker": row["Symbol"], "name": row["Security Name"]}
        for row in reader if row["ETF"] == "Y" and row["Test Issue"] == "N"
    ]
    if not funds:
        raise ValueError("Empty Nasdaq ETF directory")
    if any(not re.fullmatch(r"[A-Za-z0-9.$^_-]+", fund["ticker"]) for fund in funds):
        raise ValueError("Unexpected Nasdaq ticker")
    return funds
