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
from .roundhill import parse_roundhill
from .select import parse_select
from .tema import parse_tema
from .themes import parse_themes

PARSERS = {"ishares": parse_ishares, "themes": parse_themes, "select": parse_select, "globalx": parse_globalx, "firsttrust": parse_firsttrust,
           "ark": parse_ark, "invesco": parse_invesco, "tema": parse_tema,
           "roundhill": parse_roundhill}


def fetch(source, get, today=None):
    """Download one fund's issuer file (`source` from config/holdings_sources.yaml) and parse it.
    A `{date}` (YYYYMMDD, Global X) or `{mdy}` (MMDDYYYY, Tema) in the url, since those issuers name their files by day, is tried for today and the 6 days before; the first file that exists wins."""
    parse = lambda text: PARSERS[source["parser"]](text, **source.get("args", {}))  # args: e.g. Roundhill's account (fund) inside a shared file
    if "{date}" not in source["url"] and "{mdy}" not in source["url"]:
        return parse(get(source["url"]))
    today, error = today or date.today(), None
    for back in range(7):
        day = today - timedelta(days=back)
        try:
            # A missing day is a 404, or on Roundhill's site a 200 HTML page that does not parse; either way try the day before.
            return parse(get(source["url"].format(date=day.strftime("%Y%m%d"), mdy=day.strftime("%m%d%Y"))))
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            error = e
        except Exception as e:
            error = e
    raise ValueError(f"no file in the last 7 days ({error}): " + source["url"])
