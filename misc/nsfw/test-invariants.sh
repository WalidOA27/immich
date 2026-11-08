#!/usr/bin/env bash
# Tests misc/nsfw/invariants.sh against a throwaway git repo. Exit 0 only if every case passes.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/invariants.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
git init -q -b main .
git config user.email t@t; git config user.name t

# Upstream commit: a spec with 3 it( and 5 expect(, tagged v1.0.0.
mkdir -p server/src machine-learning server/src/schema/migrations
cat > server/src/a.spec.ts <<'S'
it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });
it('b', () => { expect(3).toBe(3); });
it('c', () => { expect(4).toBe(4); expect(5).toBe(5); });
S
echo "print()" > machine-learning/x.py
echo "export const inv = 1;" > server/src/inv.ts
git add -A && git commit -qm upstream && git tag v1.0.0

# Fork commit: FORK.md, gate scripts, and the fork's own additions to the spec (1 it, 1 expect).
mkdir -p misc/nsfw
cp "$SCRIPT" misc/nsfw/invariants.sh
echo "echo verify" > misc/nsfw/verify.sh
echo "export const inv = 2;" > server/src/inv.ts
echo "it('fork', () => { expect(6).toBe(6); });" >> server/src/a.spec.ts
cat > FORK.md <<'F'
# Fork
Base: v1.0.0

## New files

| File | Purpose |
|---|---|
| `FORK.md`, `misc/nsfw/verify.sh` | inventory, `gate` |
| `misc/nsfw/invariants.sh` | gate |

## Immich files modified

| File | What |
|---|---|
| `server/src/a.spec.ts`, `inv.ts` | bare name is relative to the first path |

## Generated files (regenerate)

- `server/src/gen/*.sql` — generated
F
git add -A && git commit -qm fork && PRE=$(git rev-parse HEAD)

pass=0; failn=0
# run_case <name> <expected exit> <expected output line or ""> -- run on a fresh branch from PRE; the
# mutation is the function `mutate` defined by the caller.
run_case() {
  local name="$1" want_rc="$2" want_out="$3"
  git checkout -q -f -B "case" "$PRE" && git clean -qfd
  mutate
  local out rc
  out="$(bash "$SCRIPT" "$PRE" v1.0.0)"; rc=$?
  if [[ $rc -eq $want_rc && "$out" == "$want_out" ]]; then echo "ok   $name"; pass=$((pass+1))
  else echo "FAIL $name (rc=$rc want $want_rc)"; echo "  got: $out"; echo "  want: $want_out"; failn=$((failn+1)); fi
}

mutate() { echo "export const inv = 3;" > server/src/inv.ts; git commit -qam c; }
run_case "clean change to inventoried file" 0 ""

mutate() { echo "# x" >> misc/nsfw/verify.sh; git commit -qam c; }
run_case "gate script modified" 1 "VIOLATION: gate script modified: misc/nsfw/verify.sh"

mutate() { git rm -q misc/nsfw/invariants.sh; git commit -qm c; }
run_case "gate script deleted" 1 "VIOLATION: gate script modified: misc/nsfw/invariants.sh"

mutate() { echo "# y" >> misc/nsfw/verify.sh; }   # uncommitted edit
run_case "gate script edited, uncommitted" 1 "VIOLATION: gate script modified: misc/nsfw/verify.sh"

mutate() { echo "print(1)" >> machine-learning/x.py; git commit -qam c; }
run_case "machine-learning touched" 1 "VIOLATION: machine-learning changed"$'\n'"OUT_OF_INVENTORY: machine-learning/x.py"

mutate() { mkdir -p server/src/schema/migrations; echo "x" > server/src/schema/migrations/1-x.ts; git add -A; git commit -qm c; }
run_case "migration added" 1 "VIOLATION: migration added"$'\n'"OUT_OF_INVENTORY: server/src/schema/migrations/1-x.ts"

# Delete the fork's own `it(` (and its expect): fork delta shrinks.
mutate() { sed -i "/it('fork'/d" server/src/a.spec.ts; git commit -qam c; }
run_case "it( and expect( dropped" 1 "VIOLATION: test count dropped in server/src/a.spec.ts"$'\n'"VIOLATION: expect count dropped in server/src/a.spec.ts"

# Delete one expect( only (inside an upstream test).
mutate() { sed -i 's/ expect(5).toBe(5);//' server/src/a.spec.ts; git commit -qam c; }
run_case "expect( dropped" 1 "VIOLATION: expect count dropped in server/src/a.spec.ts"

# Deleting an upstream-owned test is fine only if upstream tag changes; here it drops the fork delta.
mutate() { sed -i "/it('b'/d" server/src/a.spec.ts; git commit -qam c; }
run_case "upstream-owned it( dropped" 1 "VIOLATION: test count dropped in server/src/a.spec.ts"$'\n'"VIOLATION: expect count dropped in server/src/a.spec.ts"

mutate() { sed -i "s/it('a'/it.skip('a'/" server/src/a.spec.ts; git commit -qam c; }
run_case "it.skip added" 1 "VIOLATION: test count dropped in server/src/a.spec.ts"$'\n'"VIOLATION: skip/only/todo in server/src/a.spec.ts"

mutate() { echo "it.only('z', () => { expect(7).toBe(7); });" >> server/src/a.spec.ts; git commit -qam c; }
run_case ".only added" 1 "VIOLATION: skip/only/todo in server/src/a.spec.ts"

mutate() { echo "it.todo('z');" >> server/src/a.spec.ts; git commit -qam c; }
run_case "it.todo added" 1 "VIOLATION: skip/only/todo in server/src/a.spec.ts"

# New file not in the pre-run inventory; the agent also adds it to FORK.md (must not help).
mutate() {
  echo "export const foo = 1;" > server/src/foo.ts
  sed -i 's#^- `server/src/gen#| `server/src/foo.ts` | x |\n&#' FORK.md
  git add -A; git commit -qm c
}
run_case "out of inventory file" 0 "OUT_OF_INVENTORY: server/src/foo.ts"

# Generated files are ignored for the inventory report.
mutate() { mkdir -p server/src/gen; echo "x" > server/src/gen/q.sql; git add -A; git commit -qm c; }
run_case "generated file ignored" 0 ""

echo "$pass passed, $failn failed"
[[ $failn -eq 0 ]]
