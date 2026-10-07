# Standing rules for this repo

- `SPEC.md` is the source of truth. Section 5 (screening method) is approved by user. Don't change it, or the scoring code that implements it, unless he asks.
- Re-screens edit `config/` only. Give a one-line reason for every rule change.
- Never auto-merge to `main`. Work on a branch, summarize the changes, and wait for Andy's explicit approval.
- Ticker links go to issuer fund pages (`config/issuer_links.json`), never Yahoo.
- Yahoo is unofficial. Keep all Yahoo calls inside `pipeline/sources/`.
- No CDNs, external fonts or trackers on the site.
- Every claim on the site's Method panel needs its reasoning next to it (why the rule exists), in plain English.
- When unsure about a classification, list it in the report as a question for user instead of guessing.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
