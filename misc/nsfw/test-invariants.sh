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
echo "export const m = 0;" > server/src/schema/migrations/0-base.ts
mkdir -p server/test
echo "export default {};" > server/test/vitest.config.mjs
echo '{"name":"x","version":"1","scripts":{"test":"vitest"}}' > package.json
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
  out="$(bash "$SCRIPT" "${PREARG:-$PRE}" "${TAGARG:-v1.0.0}")"; rc=$?
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

# --- review fix round 1 ---
# Commented-out tests must not count.
mutate() { sed -i "s#^it('fork'#// it('fork'#" server/src/a.spec.ts; git commit -qam c; }
run_case "commented-out it(" 1 "VIOLATION: test count dropped in server/src/a.spec.ts"$'\n'"VIOLATION: expect count dropped in server/src/a.spec.ts"

mutate() { sed -i "s#^it('fork'.*#/* it('fork', () => { expect(6).toBe(6); }); */#" server/src/a.spec.ts; git commit -qam c; }
run_case "block-commented it(" 1 "VIOLATION: test count dropped in server/src/a.spec.ts"$'\n'"VIOLATION: expect count dropped in server/src/a.spec.ts"

mutate() { echo "describe.skipIf(true)('z', () => {});" >> server/src/a.spec.ts; git commit -qam c; }
run_case "describe.skipIf added" 1 "VIOLATION: skip/only/todo in server/src/a.spec.ts"

mutate() { echo "xit('z', () => {});" >> server/src/a.spec.ts; git commit -qam c; }
run_case "xit added" 1 "VIOLATION: skip/only/todo in server/src/a.spec.ts"

# Upstream itself adds an it.todo in the new tag: not the fork's doing.
mutate() {
  git checkout -q -b up v1.0.0
  sed -i "3a it.todo('upstream');" server/src/a.spec.ts; git commit -qam up; git tag -f vU >/dev/null
  git checkout -q case
  sed -i "3a it.todo('upstream');" server/src/a.spec.ts; git commit -qam c
}
TAGARG=vU run_case "upstream-added it.todo" 0 ""
git tag -d vU >/dev/null; git branch -q -D up

mutate() { git mv server/src/schema/migrations/0-base.ts server/src/schema/migrations/9-moved.ts; git commit -qm c; }
run_case "migration moved" 1 "VIOLATION: migration added"$'\n'"VIOLATION: migration modified or removed"$'\n'"OUT_OF_INVENTORY: server/src/schema/migrations/0-base.ts"$'\n'"OUT_OF_INVENTORY: server/src/schema/migrations/9-moved.ts"

mutate() { echo "// edit" >> server/src/schema/migrations/0-base.ts; git commit -qam c; }
run_case "migration modified" 1 "VIOLATION: migration modified or removed"$'\n'"OUT_OF_INVENTORY: server/src/schema/migrations/0-base.ts"

mutate() { git mv machine-learning/x.py server/src/inv.py; git commit -qm c; }
run_case "file moved out of machine-learning" 1 "VIOLATION: machine-learning changed"$'\n'"OUT_OF_INVENTORY: machine-learning/x.py"$'\n'"OUT_OF_INVENTORY: server/src/inv.py"

mutate() { echo "// x" >> server/test/vitest.config.mjs; git commit -qam c; }
run_case "vitest config edited" 1 "VIOLATION: gate script modified: server/test/vitest.config.mjs"$'\n'"OUT_OF_INVENTORY: server/test/vitest.config.mjs"

mutate() { chmod +x misc/nsfw/verify.sh; git commit -qam c; }
run_case "gate script mode changed" 1 "VIOLATION: gate script modified: misc/nsfw/verify.sh"

mutate() { sed -i 's/"vitest"/"true"/' package.json; git commit -qam c; }
run_case "package.json scripts changed" 1 "VIOLATION: package.json scripts changed: package.json"$'\n'"OUT_OF_INVENTORY: package.json"

mutate() { sed -i 's/"version":"1"/"version":"2"/' package.json; git commit -qam c; }
run_case "package.json non-script change" 0 "OUT_OF_INVENTORY: package.json"

# Ignored untracked files are not changes.
mutate() { echo ".superpowers/" >> .git/info/exclude; mkdir -p .superpowers; echo x > .superpowers/n; }
run_case "ignored untracked file" 0 ""

mutate() { :; }
TAGARG=nope run_case "missing tag" 1 "VIOLATION: missing ref nope"
PREARG=nope run_case "missing pre ref" 1 "VIOLATION: missing ref nope"

echo "$pass passed, $failn failed"
[[ $failn -eq 0 ]]
