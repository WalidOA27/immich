# Immich NSFW fork

This branch (`nsfw`) adds NSFW detection to Immich with the smallest possible diff, so it can be rebased onto
every upstream release. Design: `docs/superpowers/specs/2026-11-08-nsfw-design.md`. Plan:
`docs/superpowers/plans/2026-11-08-nsfw.md`.

Hard rules: no database migrations, no new tables, no changes under `machine-learning/`. Scores live in the
existing `asset_metadata` table (key `nsfw`), so switching back to the official image is always safe.

## New files

| File | Purpose |
|---|---|
| `FORK.md` | This inventory |
| `misc/nsfw/verify.sh` | One command that checks everything this fork touches |
| `misc/nsfw/extract_weights.py`, `misc/nsfw/make_fixture.py` | Regenerate weights/fixtures from the LAION model (numpy only) |

## Immich files modified

| File | What and why |
|---|---|

## Generated files (regenerate, never hand-edit or hand-merge)

- `open-api/immich-openapi-specs.json` — `cd server && pnpm build && mise run sync-open-api`
- `packages/sdk/src/fetch-client.ts` — `mise run open-api-typescript` (repo root)
- `server/src/queries/*.sql` — `cd server && mise run sql` (needs the dev Postgres)

## How to rebase onto a new release

```bash
export MISE_LOCKED=1            # mise must not rewrite mise.lock
git fetch upstream --tags
git rebase --onto vX.Y.Z v3.3.6 nsfw   # replace v3.3.6 with the previous base tag
# on conflicts in generated files: take upstream's version, finish the rebase, then regenerate them
mise install node pnpm npm:oazapfts && mise exec -- pnpm install --frozen-lockfile
misc/nsfw/verify.sh
```

Then update the base tag mentioned at the top of the spec/plan and in this file.

## Baseline notes

- `pnpm test -- <file>` runs the whole suite; use `pnpm exec vitest --config test/vitest.config.mjs --run <files>`.
- `@immich/sdk` and `@immich/plugin-sdk` must be built before server tests (`verify.sh` does it).
