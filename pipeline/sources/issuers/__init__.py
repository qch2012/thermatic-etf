"""Issuer holdings files (SPEC 4.1): one parser per issuer file format, all returning
{as_of: ISO date, holdings: [{name, ticker, asset_type, weight (fraction, as published), optional isin/cusip/sedol/location}]}.
Not Yahoo. `get` is the shared `pipeline.sources.http.Session().get` (throttle ≤3.3 req/s, retry with backoff on 429/5xx, User-Agent)."""
from datetime import date, timedelta
import urllib.error

from .ark import parse_ark
from .firsttrust import parse_firsttrust
from .globalx import parse_globalx
from .invesco import parse_invesco
from .ishares import parse_ishares
from .select import parse_select
from .tema import parse_tema
from .themes import parse_themes

PARSERS = {"ishares": parse_ishares, "themes": parse_themes, "select": parse_select, "globalx": parse_globalx, "firsttrust": parse_firsttrust,
           "ark": parse_ark, "invesco": parse_invesco, "tema": parse_tema}


def fetch(source, get, today=None):
    """Download one fund's issuer file (`source` from config/holdings_sources.yaml) and parse it.
    A `{date}` (YYYYMMDD, Global X) or `{mdy}` (MMDDYYYY, Tema) in the url, since those issuers name their files by day, is tried for today and the 6 days before; the first file that exists wins."""
    if "{date}" not in source["url"] and "{mdy}" not in source["url"]:
        return PARSERS[source["parser"]](get(source["url"]))
    today = today or date.today()
    for back in range(7):
        day = today - timedelta(days=back)
        try:
            text = get(source["url"].format(date=day.strftime("%Y%m%d"), mdy=day.strftime("%m%d%Y")))
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        else:
            return PARSERS[source["parser"]](text)
    raise ValueError("no file in the last 7 days: " + source["url"])
