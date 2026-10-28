# Thematic ETF Screener

Screens thematic ETFs (funds that follow one theme, such as semiconductors) and shows the results on a static site. Read `SPEC.md` for the full project.

## Overview

- A Python pipeline reads the Nasdaq ETF list, groups funds into themes, and checks each fund against the rules in `SPEC.md` section 5.
- It writes the result to `site/data/screen.json`.
- The site in `site/` reads that JSON. It has no build step.
- A GitHub Action runs the pipeline on weekdays and commits the new JSON.
- GitHub Pages serves `site/`. The repo and the site are public.

## Run locally

You need Python 3.12 or newer.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m pipeline
```

The pipeline writes `site/data/screen.json`. If any check fails, it writes nothing and exits with an error.

View the site:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory site
```

Then open http://localhost:8000.

### Stub mode (synthetic prices)

Stub mode makes up prices and profiles. Use it to test without calling Yahoo.

1. Copy `config/settings.yaml` to a temporary file, for example `/tmp/settings-stub.yaml`.
2. In the copy, set `data_source: stub`.
3. Run the pipeline with the copy and a separate output file:

```sh
python3 -m pipeline --settings /tmp/settings-stub.yaml --output /tmp/screen-stub.json
```

The site labels stub output as synthetic. Do not commit stub output.

## Tests

```sh
python3 -m pytest -q tests
node --test "tests/*.test.cjs"
```

The Python tests use synthetic data and do not need network access. The Node tests check the static site and need Node 18 or newer.

## Daily refresh

The workflow is `.github/workflows/refresh.yml`.

- **When it runs:** 22:30 UTC on weekdays. You can also start it by hand from the Actions tab (`workflow_dispatch`).
- **What it does:**
  1. Installs `requirements.txt`.
  2. Restores the last-good data cache in `.cache/`.
  3. Runs `python -m pipeline`.
  4. Commits `site/data/` if the JSON changed, then pushes. When the run succeeds, `pages.yml` deploys `site/` to GitHub Pages.
- **On failure:** nothing is published. The job opens a GitHub issue titled "Daily refresh failed", or adds a comment to the open one. The issue links to the run log. The site keeps the last good data and shows a stale banner after 2 trading days.

To fix a failure, read the run log, fix the cause, then run the job by hand.

## Re-screen

A re-screen reviews the fund list and updates the rules. Ask Claude Code to run `/rescreen`. It follows `.claude/commands/rescreen.md` and `SPEC.md` section 9.

The steps are:

1. Pull `main` and create a branch named `rescreen/<date>`.
2. Run `python3 -m pipeline`, then `python3 -m pipeline.report`.
3. Read `reports/rescreen-<date>.md`.
4. Edit files in `config/` only. Give a one-line reason for every change.
5. Run the tests and the pipeline again.
6. Commit to the branch. Do not merge. Andy approves the merge.

Do not change the scoring code or `SPEC.md` section 5 during a re-screen.

## Hosting

GitHub Pages serves `site/` for free. Free Pages needs a public repo, so the code, data and site are all public. One-time setup, done by Andy:

1. Make the repo public: **Settings** > **General** > **Danger Zone** > **Change visibility**.
2. Go to **Settings** > **Pages**. Under **Source**, pick **GitHub Actions**.
3. Push `main`. `pages.yml` deploys `site/` on every push to `main` and after every successful refresh. Run it by hand from **Actions** > **pages** if needed.
4. The site is at `https://<user>.github.io/<repo>/`. Open it and check the table loads.

## Not yet built

Charts, ranking history, live weights, and schema validation are later stages. Re-screens remain config-only and need review before merging.
