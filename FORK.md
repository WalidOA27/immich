# Immich NSFW fork

Base: v3.3.6

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
| `misc/nsfw/invariants.sh`, `misc/nsfw/test-invariants.sh` | Deterministic gate for automated maintenance (gate scripts unchanged, no migrations/ML changes, test counts not dropped; reports files outside this inventory) |
| `misc/nsfw/e2e.sh` | End-to-end check against the throwaway instance (gate script) |
| `misc/nsfw/build.sh` | Builds `immich-server:nsfw-<base tag>` locally |
| `misc/nsfw/docker-compose.test.yml` | Throwaway instance on :2284 for manual/e2e tests (after start, run Smart Search → Missing: uploads made before ML is ready fail upstream-style) |
| `misc/nsfw/extract_weights.py`, `misc/nsfw/make_fixture.py`, `misc/nsfw/README.md` | Regenerate weights/fixtures from the LAION model (numpy only) |
| `server/src/nsfw/nsfw.ts` | Scorer, threshold, constants |
| `server/src/nsfw/laion-clip-b32.weights.ts`, `nsfw.fixture.json` | Generated weights and test fixture |
| `server/src/nsfw/nsfw.spec.ts` | Scorer tests |
| `server/src/services/nsfw.service.ts`, `nsfw.service.spec.ts` | NSFW Detection queue handlers; warns at startup on invalid `IMMICH_NSFW_THRESHOLD` |
| `web/src/lib/stores/nsfw.store.ts` | Persisted mode `nsfw-mode`: `show` / `blur` / `hide` |
| `web/src/lib/components/shared-components/NsfwToggle.svelte` | 3-state toggle (reloads when entering/leaving hide) |
| `web/src/lib/components/assets/thumbnail/__test__/nsfw-blur.spec.ts`, `web/src/lib/managers/timeline-manager/nsfw-hide.svelte.spec.ts` | Web tests |
| `docs/superpowers/specs/2026-11-08-nsfw-design.md`, `docs/superpowers/plans/2026-11-08-nsfw.md`, `docs/superpowers/specs/2026-11-08-maintainer-design.md`, `docs/superpowers/plans/2026-11-08-maintainer.md` | Design specs and plans |
| `server/src/nsfw/nsfw.sql.ts` | `isNsfwAsset(threshold)` SQL fragment (tolerates malformed metadata) |

## Immich files modified

| File | What and why |
|---|---|
| `server/src/enum.ts` | `QueueName.NsfwDetection` (last, so queue order/indices of upstream don't shift), `JobName.AssetDetectNsfw*` |
| `server/src/types.ts` | Job items; NSFW queue excluded from `ConcurrentQueueName` (concurrency 1, no config change) |
| `server/src/services/queue.service.ts` | Start case for the queue; listed as non-concurrent |
| `server/src/dtos/queue-legacy.dto.ts` | Queue in the legacy queues response |
| `server/src/services/job.service.ts` | After `SmartSearch`, queue `AssetDetectNsfw` with `force: true` (one line) |
| `server/src/services/index.ts` | Register `NsfwService` |
| `server/src/services/job.service.spec.ts`, `queue.service.spec.ts` | Expectations for the extra chained job / extra queue |
| `server/src/dtos/time-bucket.dto.ts` | Query param `withoutNsfw`; response column `isNsfw` |
| `server/src/repositories/asset.repository.ts` | Import + `withoutNsfw` option + filter in `getTimeBuckets`/`getTimeBucket` + `isNsfw` column (threshold read here, so `timeline.service.ts` is untouched) |
| `web/src/lib/components/assets/thumbnail/Thumbnail.svelte` | Import + `blur-2xl` class in blur mode |
| `web/src/lib/components/shared-components/navigation-bar/NavigationBar.svelte` | `<NsfwToggle />` before the theme button |
| `web/src/lib/managers/timeline-manager/types.ts`, `timeline-month.svelte.ts` | `isNsfw` on `TimelineAsset`, mapped from the bucket |
| `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`, `internal/load-support.svelte.ts` | `withoutNsfw` in hide mode |
| `web/src/lib/services/queue.service.ts`, `web/src/routes/admin/system-settings/JobSettings.svelte` | Queue entry in Job Queues / title map |
| `web/src/test-data/factories/asset-factory.ts` | `isNsfw` in the bucket response factory |
| `i18n/en.json`, `i18n/es.json` | 5 keys each |
| `server/test/medium/specs/services/timeline.service.spec.ts` | `isNsfw: []` in the empty-bucket expectation; NSFW block at the end |

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
