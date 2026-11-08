#!/usr/bin/env bash
# Deterministic gate for automated maintenance of the NSFW fork.
# Usage: misc/nsfw/invariants.sh <pre_run_ref> <upstream_tag>
#   exit 0: no violation; exit 1: one "VIOLATION: <reason>" line per problem on stdout.
#   Always prints "OUT_OF_INVENTORY: <path>" for files differing from <upstream_tag> that FORK.md
#   (as of <pre_run_ref>) does not name. That is informational, not a failure.
# Gate scripts and FORK.md are read from <pre_run_ref> via git show, never from the working tree,
# so the agent cannot weaken its own gate. Contract: the orchestrator also runs the gate scripts from
# copies extracted from <pre_run_ref>, so a doctored working-tree copy can never be the one that runs.
set -euo pipefail

PRE="${1:?usage: invariants.sh <pre_run_ref> <upstream_tag>}"
TAG="${2:?usage: invariants.sh <pre_run_ref> <upstream_tag>}"
GATES=(misc/nsfw/verify.sh misc/nsfw/invariants.sh misc/nsfw/e2e.sh)

git() { command git -c core.quotepath=off "$@"; }
cd "$(git rev-parse --show-toplevel)"
fail=0
TMPV="$(mktemp)"; trap 'rm -f "$TMPV"' EXIT
violation() { echo "VIOLATION: $*"; fail=1; }

exists_at() { git cat-file -e "$1:$2" 2>/dev/null; }
# Prints the file content at rev ("WT" = working tree); nothing if missing.
content() {
  if [[ "$1" == WT ]]; then [[ -f "$2" ]] && cat -- "$2" || true
  else git show "$1:$2" 2>/dev/null || true; fi
}
# Drop // and /* */ comments so commented-out tests do not count (a "://" in a URL is kept).
strip_comments() { perl -0777 -pe 's{/\*.*?\*/}{}gs; s{(?<!:)//[^\n]*}{}g'; }
# count <rev|WT> <path> <ERE>
count() { content "$1" "$2" | strip_comments | { grep -oE "$3" || true; } | wc -l; }

need_ref() { git rev-parse --verify --quiet "$1^{commit}" >/dev/null || { echo "VIOLATION: missing ref $1"; exit 1; }; }
need_ref "$PRE"; need_ref "$TAG"
fork_md="$(git show "$PRE:FORK.md")"
BASE="$(sed -nE 's/^Base: (v[0-9]+\.[0-9]+\.[0-9]+)$/\1/p' <<<"$fork_md" | head -1)"
[[ -n "$BASE" ]] || { echo "VIOLATION: no 'Base: vX.Y.Z' line in FORK.md at $PRE"; exit 1; }
need_ref "$BASE"

# Files changed in the working tree (committed or not, incl. untracked) relative to a rev.
changed_vs() { { git diff --no-renames --name-only "$1" --; git ls-files -o --exclude-standard; } | sort -u; }

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

# --- Protected files: must be byte- and mode-identical to <pre_run_ref>
# --- (git diff --quiet compares the working tree incl. mode; a file missing from the tree differs)
for g in misc/nsfw/verify.sh misc/nsfw/invariants.sh misc/nsfw/e2e.sh misc/nsfw/build.sh \
         misc/nsfw/test-invariants.sh misc/nsfw/docker-compose.test.yml; do
  exists_at "$PRE" "$g" || continue
  git diff --quiet "$PRE" -- "$g" || violation "gate script modified: $g"
done
# Test/build configs: may only differ from PRE by being upstream's own version at <upstream_tag>.
CONFIG_RE='(^|/)(vitest|vite|jest)\.config\.[^/]*$|(^|/)test/vitest[^/]*\.mjs$'
{ git ls-tree -r --name-only "$PRE"; changed_vs "$PRE"; } | sort -u | grep -E "$CONFIG_RE" | while IFS= read -r f; do
  git diff --quiet "$PRE" -- "$f" && continue
  git diff --quiet "$TAG" -- "$f" 2>/dev/null && continue
  echo "VIOLATION: gate script modified: $f"
done > "$TMPV" || true
# package.json: the fork's own scripts delta (vs upstream) must equal what it was at <pre_run_ref>.
scripts_delta() { # <rev|WT> <rev> <path>
  diff <(content "$1" "$3" | jq -S '.scripts // {}' 2>/dev/null || echo '"invalid"') \
       <(content "$2" "$3" | jq -S '.scripts // {}' 2>/dev/null || echo '"invalid"') || true
}
changed_vs "$PRE" | grep -E '(^|/)package\.json$' | while IFS= read -r f; do
  [[ "$(scripts_delta WT "$TAG" "$f")" == "$(scripts_delta "$PRE" "$BASE" "$f")" ]] || echo "VIOLATION: package.json scripts changed: $f"
done >> "$TMPV" || true
if [[ -s "$TMPV" ]]; then cat "$TMPV"; fail=1; fi

# --- machine-learning and migrations (relative to the upstream tag; renames split into A+D)
changed_up="$(changed_vs "$TAG")"
grep -q '^machine-learning/' <<<"$changed_up" && violation "machine-learning changed"
mig="$({ git diff --no-renames --name-status "$TAG" -- server/src/schema/migrations/ 2>/dev/null
  git ls-files -o --exclude-standard -- server/src/schema/migrations/ 2>/dev/null | sed 's/^/A\t/'; } | sort -u)"
grep -q '^A' <<<"$mig" && violation "migration added"
grep -q '^[^A]' <<<"$mig" && violation "migration modified or removed"

# --- Specs: the fork's own delta (file vs its base) must not shrink
specs="$({ git diff --no-renames --name-only "$BASE" "$PRE" --; grep -E '\.spec\.ts$' <<<"$changed_up" || true; } | grep -E '\.spec\.ts$' | sort -u || true)"
TEST_RE='\b(it|test)\('
EXPECT_RE='\bexpect\('
SKIP_RE='\.(skip|only|todo|skipIf|runIf|fails)\b|\b(xit|xdescribe|xtest)\('
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  for kind in test expect; do
    re="$TEST_RE"; [[ $kind == expect ]] && re="$EXPECT_RE"
    now=$(( $(count WT "$f" "$re") - $(count "$TAG" "$f" "$re") ))
    was=$(( $(count "$PRE" "$f" "$re") - $(count "$BASE" "$f" "$re") ))
    (( now >= was )) || violation "$kind count dropped in $f"
  done
  now=$(( $(count WT "$f" "$SKIP_RE") - $(count "$TAG" "$f" "$SKIP_RE") ))
  was=$(( $(count "$PRE" "$f" "$SKIP_RE") - $(count "$BASE" "$f" "$SKIP_RE") ))
  (( now <= was )) || violation "skip/only/todo in $f"
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
