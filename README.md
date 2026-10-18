# Thematic ETF Screener

Screens thematic ETFs (funds that follow one theme, such as semiconductors) and shows the results on a static site. Read `SPEC.md` for the full project.

This repo is private. Do not publish the site until Cloudflare Access protects every URL it is served from (see Hosting).

## Overview

- A Python pipeline reads the Nasdaq ETF list, groups funds into themes, and checks each fund against the rules in `SPEC.md` section 5.
- It writes the result to `site/data/screen.json`.
- The site in `site/` reads that JSON. It has no build step.
- A GitHub Action runs the pipeline on weekdays and commits the new JSON.
- Cloudflare Pages serves `site/`. Cloudflare Access checks your email before anyone can see it.

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
  4. Commits `site/data/` if the JSON changed, then pushes. The push triggers a Cloudflare Pages deploy.
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

Three services work together: GitHub holds the code, Cloudflare Pages serves the site, and Cloudflare Access controls who can view it. The steps below are one-time setup. Only Andy can do them, because they need his accounts.

### 1. GitHub

1. Keep the repo private.
2. Push `main`. The refresh workflow needs `contents: write` and `issues: write`. Both are already set in `refresh.yml`.

### 2. Cloudflare Pages

Source: [Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/).

1. In the Cloudflare dashboard, go to **Workers & Pages**. Select **Create application**, then **Pages**, then **Connect to Git**.
2. Pick GitHub and authorize it. Choose this repo.
3. Set the **Production branch** to `main`.
4. Set the **Framework preset** to none.
5. Leave the **Build command** empty.
6. Set the **Build output directory** to `site`.
7. Select **Save and Deploy**.

Note the project name. It sets the URL `<project>.pages.dev`.

### 3. Cloudflare Access

Access must cover two things: the production URL (`<project>.pages.dev`, plus your custom domain if you add one) and the preview URLs (`*.<project>.pages.dev`).

Pages has its own switch for previews, but it does not cover the production URL. Use both steps below.

**a. Preview switch (optional, extra safety).** In the Pages project, go to **Settings** > **General** and turn on **Enable access policy**. Source: [Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/). The doc says this only protects previews, not `*.pages.dev` or a custom domain.

**b. Login method.** Turn on One-time PIN.

1. Go to **Zero Trust** > **Integrations** > **Identity providers**.
2. Select **Add new identity provider**, then **One-time PIN**.

Source: [One-time PIN](https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/).

**c. Access application.** Go to **Zero Trust** > **Access controls** > **Applications**.

1. Select **Create new application**, then **Self-hosted and private**.
2. Add a public hostname for `<project>.pages.dev`.
3. Add another public hostname for `*.<project>.pages.dev` to cover previews. Add your custom domain too, if you have one.
4. Under **Identity providers**, select One-time PIN only.
5. Add a policy. Set the action to **Allow**. Under **Include**, pick the selector **Emails** and enter `<your-email>`.
6. Save the application.

Source: [Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/). The doc says applications deny by default, so the Allow policy is what lets you in.

### 4. Verify privacy

Do this after setup. Open a private (incognito) window for each check.

1. Open `https://<project>.pages.dev`. Expect a login page that asks for an email.
2. Open a preview URL, such as the `https://<hash>.<project>.pages.dev` link from a Pages deployment. Expect the same login page.
3. Enter `<your-email>`, then the PIN from the email. Expect the site to load.

If either URL loads without a login, stop. Do not share the link.

## Not yet built

Charts, ranking history, live weights, and schema validation are later stages. Re-screens remain config-only and need review before merging.
