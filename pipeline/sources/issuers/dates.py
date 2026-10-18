from datetime import timedelta


def previous_business_day(day):
    """Themes and Roundhill date a file with the next trade date; the holdings are as of the trading day before."""
    return day - timedelta(days={0: 3, 6: 2}.get(day.weekday(), 1))
