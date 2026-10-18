def _value(char):
    return int(char, 36)  # digits 0-9, letters A-Z = 10-35


def identifiers(code):
    """Classify an issuer's security code: {"cusip": code} for a 9-character CUSIP/CINS, {"sedol": code} for a 7-character SEDOL,
    else {}. Both have a check digit, so placeholders such as `CASHEUR`, `X9USDGSFT` or `BREADUMMY` are rejected, not passed on
    as identifiers (matching treats any identifier we emit as real)."""
    code = (code or "").strip().upper()
    if not code.isalnum():
        return {}
    if len(code) == 9:
        total = 0
        for i, char in enumerate(code[:8]):
            v = _value(char) * (2 if i % 2 else 1)
            total += v // 10 + v % 10
        return {"cusip": code} if code[8].isdigit() and (10 - total % 10) % 10 == int(code[8]) else {}
    if len(code) == 7:
        total = sum(_value(char) * w for char, w in zip(code[:6], (1, 3, 1, 7, 3, 9)))
        return {"sedol": code} if code[6].isdigit() and (10 - total % 10) % 10 == int(code[6]) else {}
    return {}
