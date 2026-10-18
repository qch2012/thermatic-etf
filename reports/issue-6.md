# Issue #6: price charts

Branch: `feat/6-price-charts` (stacked on `feat/5-live-weights`). Not merged, not pushed.

## Delivered

- Click a fund name: its adjusted-close chart (whatever the price file covers, up to 3 years). Click a theme heading (themes with a window): the theme's measured funds (`cumulative_return != null`) rebased to 100 at `window.start`, with the window shaded and a dashed line at 100.
- Hand-written inline SVG (about 100 lines in `site/app.js`). No charting library, so nothing is vendored and `site/vendor/` is not created.
- Price files load lazily, one request per ticker, cached for the page's life (a failed load is retried on the next click). Nothing price-related loads at page load. A fund with no price data (`age` missing) makes no request and says so.
- Theme chart: the 3 best peers by current live rank are drawn in three colors with end-of-line labels; the rest are thin grey lines ("N other measured funds"). The 3 colors passed `validate_palette.js` (light surface); with the labels the chart does not rely on color alone. A peer with no price file or no price on the window start is left out and named under the chart.
- A sticky panel at the bottom of the window shows the chart so the table keeps its place. Focus moves to "Close chart", and back to the trigger on close. Clicking the same trigger again closes it. The chart has a text summary (start and end values, or rebased values on the window end date) that is also the SVG's `aria-label`.
- Page hint: "Select a fund name for its adjusted-close chart, or a theme heading to compare its measured funds."

## Verification

- `python3 -m pytest -q tests` -> 20 passed, 4 subtests passed.
- `node --test "tests/*.test.cjs"` -> 20 passed, 0 failed. New tests (red first): lazy and cached loading; fund chart title, svg and literal summary values (40.00 / 65.60); toggling and Close; escaping of a fund name containing `<b>`; missing file and no-price-data messages; theme chart fetches only the measured peers, rebases to literal values (65.6/50 -> 131.2, 20/25 -> 80.0), shades the window with the right dates, and reports a peer without a file.
- Browser (Chrome, local server, stub run): theme chart for Semiconductors drew 17 lines (3 colored, 14 grey), fund chart drew, Close works, focus lands on Close; console shows no errors or warnings.

## Deferred

- No hover crosshair or value tooltip (SPEC 6.3 doesn't ask for one); values are in the text summary.
- No chart for themes with no window (nothing is measured there).
- The stub data is synthetic and noisy, so the real look of the lines was not seen with live Yahoo data.

## Questions for Andy

- None.

## Review fixes

- Closing a chart returned focus to a detached button when the table had re-rendered (slider moved, filter changed). Now the trigger is looked up by chart key in the current render, falling back to the table region when it is no longer shown. Test added (red first).
