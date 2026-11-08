#!/usr/bin/env bash
# Deterministic gate for automated maintenance of the NSFW fork.
# Usage: misc/nsfw/invariants.sh <pre_run_ref> <upstream_tag>
#   exit 0: no violation; exit 1: one "VIOLATION: <reason>" line per problem on stdout.
#   Always prints "OUT_OF_INVENTORY: <path>" for files differing from <upstream_tag> that FORK.md
#   (as of <pre_run_ref>) does not name. That is informational, not a failure.
# Gate scripts and FORK.md are read from <pre_run_ref> via git show, never from the working tree,
# so the agent cannot weaken its own gate.
set -euo pipefail

PRE="${1:?usage: invariants.sh <pre_run_ref> <upstream_tag>}"
TAG="${2:?usage: invariants.sh <pre_run_ref> <upstream_tag>}"
GATES=(misc/nsfw/verify.sh misc/nsfw/invariants.sh misc/nsfw/e2e.sh)

cd "$(git rev-parse --show-toplevel)"
git config core.quotepath off 2>/dev/null || true
fail=0
violation() { echo "VIOLATION: $*"; fail=1; }

exists_at() { git cat-file -e "$1:$2" 2>/dev/null; }
# Prints the file content at rev ("WT" = working tree); nothing if missing.
content() {
  if [[ "$1" == WT ]]; then [[ -f "$2" ]] && cat -- "$2" || true
  else git show "$1:$2" 2>/dev/null || true; fi
}
# count <rev|WT> <path> <ERE>
count() { content "$1" "$2" | { grep -oE "$3" || true; } | wc -l; }

fork_md="$(git show "$PRE:FORK.md")"
BASE="$(sed -nE 's/^Base: (v[0-9]+\.[0-9]+\.[0-9]+)$/\1/p' <<<"$fork_md" | head -1)"
[[ -n "$BASE" ]] || { echo "VIOLATION: no 'Base: vX.Y.Z' line in FORK.md at $PRE"; exit 1; }

# Files changed in the working tree (committed or not, incl. untracked) relative to a rev.
changed_vs() { { git diff --name-only "$1" --; git ls-files -o --exclude-standard; } | sort -u; }

# --- Inventory: backticked paths in the first cell of table rows; a bare filename in a cell with
# --- a full path lives in that path's directory. Generated files (bullets) are only ignored.
inventory="$(awk -F'|' '
  /^\|/ {
    cell=$2; dir=""; dirset=0
    while (match(cell, /`[^`]+`/)) {
      tok=substr(cell, RSTART+1, RLENGTH-2); cell=substr(cell, RSTART+RLENGTH)
      if (tok ~ /\//) { d=tok; sub(/[^\/]*$/, "", d); if (!dirset) dir=d; print tok }
      else print dir tok
      # a relative path inside a multi-path cell (e.g. `a/b.ts`, `internal/c.ts`): accept both readings
      if (tok ~ /\// && dirset) print dir tok
      if (tok ~ /\//) dirset=1
    }
  }' <<<"$fork_md")"
generated="$(awk '/^## Generated files/{g=1;next} /^## /{g=0} g && /^- `/{ s=$0; sub(/^- `/,"",s); sub(/`.*/,"",s); print s }' <<<"$fork_md")"

# --- Gate scripts (only those that exist at pre_run_ref)
for g in "${GATES[@]}"; do
  exists_at "$PRE" "$g" || continue
  if [[ ! -f "$g" ]] || [[ "$(git show "$PRE:$g")" != "$(cat "$g")" ]]; then
    violation "gate script modified: $g"
  fi
done

# --- machine-learning and migrations (relative to the upstream tag)
changed_up="$(changed_vs "$TAG")"
grep -q '^machine-learning/' <<<"$changed_up" && violation "machine-learning changed"
added_migrations="$({ git diff --name-only --diff-filter=A "$TAG" -- server/src/schema/migrations/
  git ls-files -o --exclude-standard -- server/src/schema/migrations/ 2>/dev/null; } | sort -u)"
[[ -z "$added_migrations" ]] || violation "migration added"

# --- Specs: the fork's own delta (file vs its base) must not shrink
specs="$({ git diff --name-only "$BASE" "$PRE" --; grep -E '\.spec\.ts$' <<<"$changed_up" || true; } | grep -E '\.spec\.ts$' | sort -u || true)"
TEST_RE='\b(it|test)\('
EXPECT_RE='\bexpect\('
SKIP_RE='\.(skip|only|todo)\('
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  for kind in test expect; do
    re="$TEST_RE"; [[ $kind == expect ]] && re="$EXPECT_RE"
    now=$(( $(count WT "$f" "$re") - $(count "$TAG" "$f" "$re") ))
    was=$(( $(count "$PRE" "$f" "$re") - $(count "$BASE" "$f" "$re") ))
    (( now >= was )) || violation "$kind count dropped in $f"
  done
  (( $(count WT "$f" "$SKIP_RE") <= $(count "$PRE" "$f" "$SKIP_RE") )) || violation "skip/only/todo in $f"
done <<<"$specs"

# --- Out-of-inventory report
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  grep -qxF -- "$f" <<<"$inventory" && continue
  skip=0
  while IFS= read -r pat; do
    [[ -n "$pat" ]] || continue
    # shellcheck disable=SC2254
    case "$f" in $pat) skip=1; break ;; esac
  done <<<"$generated"
  (( skip )) || echo "OUT_OF_INVENTORY: $f"
done <<<"$changed_up"

exit "$fail"
