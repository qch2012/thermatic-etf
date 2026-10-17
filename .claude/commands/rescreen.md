Re-screen the thematic ETF universe. Follow SPEC.md section 9.

1. Pull `main`. Create branch `rescreen/<today's date>`.
2. Run `python3 -m pipeline`, then `python3 -m pipeline.report`, and read the report (`reports/rescreen-<date>.md`) fully.
3. For each item, decide: add/adjust a theme rule, add an override, add to `exclude_tickers`, add an issuer link, refresh a net-asset override, or no change. Ask Andy about anything ambiguous instead of guessing.
4. Edit only files in `config/`. Do not touch scoring code or SPEC.md section 5.
5. Run the tests and the full pipeline locally.
6. Report back with: rule changes and reasons, funds added/removed per theme, top-3 entries/exits per theme, open questions.
7. Add a CHANGELOG entry and commit to the branch. Do not merge. Wait for Andy's approval.
