# Issue #5: live weights

Branch: `feat/5-live-weights` (stacked on `feat/4-main-screen` @ 5320b89). Not merged, not pushed.

## Delivered

- Sliders for size, cost and performance weights (0 to 100 each, start at the pipeline's `weights` x 100), plus a top-N slider (1 to 10, default 3). The outputs show the normalized split ("40%"). All-zero sliders fall back to the default split.
- `rescore()` recomputes score and rank in the browser from `percentiles`, with the contract's formula, operand order and tie-break (score desc, net assets desc, ticker asc). Rank, Score, the Rank sort, the Top N cut and the default row order all use the live values.
- "Reset to default" restores weights and top-N. A line under the sliders says whether the weights are default or custom.
- Note beside the sliders: gates and performance windows stay as the pipeline computed them.
- The "Top 3 per theme" option label follows the top-N slider.
- Andy's decision A: "Hide under $50M" also hides funds with unknown net assets.
- Andy's decision B: in the Top view the "Themes with no eligible fund" section lists theme names only, with a count in the heading. All eligible and All screened keep the full candidate rows.
- Coordinator update (#7): `first_trade_date: null` shows as a dash in the Launched column (`fetched_at` is not shown anywhere).
- `docs/contract.md` "How the site reads it": updated the Hide-under-$50M, Top 3 and no-eligible bullets to match. No data field changed.

## Verification

- `python3 -m pytest -q tests` -> 20 passed, 4 subtests passed.
- `node --test "tests/*.test.cjs"` -> 17 passed, 0 failed. New or changed tests (written first, red before the code):
  - Default weights reproduce the pipeline: the stub-pipeline test now also checks, for every theme, that the row order equals the pipeline rank order and (already) that every Rank cell equals `rank`.
  - Sliders start at 40/20/40; 50/25/50 gives the same normalized split and the same scores.
  - Size-only weights reorder funds, ranks and scores to literal expected values; Top view follows the live rank; Reset restores order and sliders.
  - Rank sort follows the live rank. Equal scores rank by net assets then ticker. Top-N slider and label. Zero weights fall back to defaults. The note is in the page next to the sliders.
  - A: unknown net assets hidden. B: names-only section with count, with group and search filters, and full rows in the other views. `first_trade_date: null` shows a dash.
- Browser (Chrome, `python3 -m http.server -d site`, stub run on the seed-ticker fixture): no console errors; the first rows of the table match the default order, change when size-only weights are applied, and return to the exact default after Reset.

## Deferred

- 390 px check for the new controls: done with #12.

## Questions for Andy

- The count in the no-eligible heading is the number of themes listed (after filters). Say if you wanted candidate counts per theme instead.
