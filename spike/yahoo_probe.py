# TEMPORARY spike for issue #1: can a GitHub-hosted runner reach Yahoo? Delete after deciding.
import collections, json, sys, time, urllib.error, urllib.request, http.cookiejar

TICKERS = "SMH SOXX LAZR BOTZ ROBO ARKK ITA SHLD NATO EUAD URA NLR CQQQ KWEB MJ ARKW WDEF CIBR SKYY QTUM".split()
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
op.addheaders = [("User-Agent", "Mozilla/5.0")]
counts = collections.defaultdict(collections.Counter)

def get(kind, url):
    try:
        with op.open(url, timeout=20) as r:
            counts[kind][r.status] += 1
            return r.read()
    except urllib.error.HTTPError as e:
        counts[kind][e.code] += 1
    except Exception as e:
        counts[kind][type(e).__name__] += 1

try: op.open("https://fc.yahoo.com", timeout=10)
except Exception: pass  # only sets cookies; usually 404
crumb = (get("crumb", "https://query1.finance.yahoo.com/v1/test/getcrumb") or b"").decode()
for t in TICKERS:
    get("chart", f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?range=5y&interval=1d")
    time.sleep(0.3)
    body = get("quoteSummary", f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{t}?modules=summaryDetail,fundProfile,topHoldings,price&crumb={crumb}")
    if body and not json.loads(body)["quoteSummary"]["result"]:
        counts["quoteSummary"]["empty"] += 1
    time.sleep(0.3)
print("crumb ok:", bool(crumb) and "<" not in crumb)
print(json.dumps({k: dict(v) for k, v in counts.items()}, indent=1))
ok = all(set(v) <= {200} for v in counts.values())
sys.exit(0 if ok else 1)
