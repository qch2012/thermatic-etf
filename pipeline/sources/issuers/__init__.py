"""Issuer holdings files (SPEC 4.1): one parser per issuer file format, all returning
{as_of: ISO date, holdings: [{name, ticker, asset_type, weight (fraction, as published), optional isin/cusip/sedol/location}]}.
Not Yahoo. `get` is the shared `pipeline.sources.http.Session().get` (throttle ≤3.3 req/s, retry with backoff on 429/5xx, User-Agent)."""
from .ishares import parse_ishares

PARSERS = {"ishares": parse_ishares}


def fetch(source, get):
    """Download one fund's issuer file (`source` from config/holdings_sources.yaml) and parse it."""
    return PARSERS[source["parser"]](get(source["url"]))
