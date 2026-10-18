# Issue #13: Hosting README

## Local checks (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Python tests | `.venv/bin/python3 -m pytest -q tests` | 84 passed, 4 subtests passed |
| Node tests | `node --test "tests/*.test.cjs"` | 45 pass, 0 fail (Node 24.13.1) |
| Stub pipeline | `python3 -m pipeline --settings <temp copy with data_source: stub> --output <temp> --directory tests/fixtures/nasdaqtraded_2026-10-17_seed_tickers.txt` | exit 0, 360 funds, `synthetic: true`, `data_source: stub` |
| Re-screen report | `python3 -m pipeline.report --date 2026-10-18 --screen <stub output> --directory <fixture> --reports-dir <temp>` | exit 0, wrote `rescreen-2026-10-18.md` and `.universe.csv` |
| Site smoke | `python3 -m http.server 8765 --bind 127.0.0.1 --directory site`, then curl | `/` 200, `/data/screen.json` 200 |

Notes:
- Stub run used the offline Nasdaq fixture, so no network was needed.
- The Yahoo (default) run was not done. It needs live network calls.
- The default `python3 -m pipeline` output in `site/data/` was not regenerated. Nothing under `site/` changed.
- The report step needs a `--reports-dir` that exists. It does not create the folder. The README does not mention this.

## Cloudflare steps: needs Andy

Not run by me. Do these in the Cloudflare dashboard:

1. Create the Pages project from the GitHub repo. Build command empty, output directory `site`.
2. Turn on One-time PIN.
3. Create a self-hosted Access app covering `<project>.pages.dev`, `*.<project>.pages.dev`, and any custom domain. Policy: Allow, Include, Emails, `<your-email>`.
4. Optional: turn on the Pages "Enable access policy" switch (previews only).
5. Private-window check: open the production URL and one preview URL. Each must show the Access login. Log in with the PIN to confirm access.

Open question for Andy: the Pages docs say the preview switch does not cover `*.pages.dev`. I could not load the Cloudflare page on Access rules for Emails or the known-issues page (both returned 404). The wildcard hostname step in the README is from the Access app doc, not confirmed on a live app. Please confirm in the dashboard.

## Doc URLs used

- https://developers.cloudflare.com/pages/get-started/git-integration/ (Pages setup, build output field)
- https://developers.cloudflare.com/pages/configuration/git-integration/ (redirects to the page above, used for preview and branch notes)
- https://developers.cloudflare.com/pages/configuration/preview-deployments/ (Access for previews; "Enable access policy"; does not cover `*.pages.dev`)
- https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/ (self-hosted app, deny by default)
- https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/ (enable OTP)
- Not loaded (404): `pages/how-to/use-access-to-protect-a-site/`, `pages/known-issues/`, `cloudflare-one/policies/access/policy-rules/`
