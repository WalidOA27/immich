#!/usr/bin/env bash
# Verifies everything the NSFW fork adds or touches. Exit 0 only if all checks pass.
# Usage: misc/nsfw/verify.sh   (from anywhere; needs mise + docker for the medium tests)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export MISE_LOCKED=1
run() { echo "==> $*"; mise exec -- "$@"; }

cd "$ROOT"
run pnpm --filter @immich/sdk --filter @immich/plugin-sdk build

cd "$ROOT/server"
SERVER_UNIT=(src/services/duplicate.service.spec.ts src/services/job.service.spec.ts src/services/queue.service.spec.ts)
for f in src/nsfw/nsfw.spec.ts src/services/nsfw.service.spec.ts; do
  [[ -f "$f" ]] && SERVER_UNIT+=("$f")
done
run pnpm exec vitest --config test/vitest.config.mjs --run "${SERVER_UNIT[@]}"
run pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/timeline.service.spec.ts
run pnpm check

cd "$ROOT/web"
run pnpm exec vitest --run src/lib/components/assets/thumbnail
run pnpm check:typescript

echo "verify: OK"
