import http.cookiejar
import time
import urllib.error
import urllib.request


class Session:
    """One cookie session, at most 3.3 requests/s including retries."""

    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self.opener.addheaders = [("User-Agent", "Mozilla/5.0")]
        self.last_request = 0.0

    def get(self, url, raw=False):
        for attempt in range(4):
            time.sleep(max(0, 0.3 - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            try:
                with self.opener.open(url, timeout=30) as response:
                    body = response.read()
                    return body if raw else body.decode("utf-8-sig")
            except urllib.error.HTTPError as error:
                if attempt == 3 or (error.code != 429 and not 500 <= error.code < 600):
                    raise
                error.close()
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
            time.sleep(2 ** attempt)
