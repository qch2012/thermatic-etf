from typing import Protocol


class Source(Protocol):
    def history(self, ticker: str) -> dict:
        """first_trade_date (ISO), prices [{date, close, adjusted_close (or None), volume}]."""
        ...

    def profile(self, ticker: str) -> dict:
        """net_assets (USD or None), expense_ratio (fraction or None), assets_source; optional warnings list."""
        ...


def create(name: str) -> Source:
    if name == "yahoo":
        from .yahoo import Yahoo
        return Yahoo()
    if name == "stub":
        from .stub import Stub
        return Stub()
    raise ValueError(f"Unknown data_source: {name}")
