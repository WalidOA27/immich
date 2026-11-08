# Immich Fork Auto-Maintainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-starting container on archD that carries the `nsfw` patch onto each new upstream Immich release and hands back a PR + image tar, never deploying.

**Architecture:** A Python supervisor (deterministic) polls GitHub releases; on a new one it runs a LangGraph graph (SQLite checkpoint) whose nodes are: prepare (git rebase) → gates (shell scripts, sole authority) → builder/verifier (opencode + DeepSeek) → publish (PR) → image (tar) → end. Side effects sit behind small adapter classes so the graph is unit-tested with fakes. The stack is `agent` + `dind` in Docker Compose with `restart: unless-stopped`; a host firewall unit blocks the stack from the LAN.

**Tech Stack:** Python 3.12 (container), `langgraph==1.2.20`, `langgraph-checkpoint-sqlite==3.1.3`, `httpx`, pytest; opencode v2.2.5 with model `opencode-go/deepseek-v4.1-flash`; mise toolchain from the fork; `docker:29-dind`; bash for fork gate scripts.

**Spec:** `docs/superpowers/specs/2026-11-08-maintainer-design.md` (in the fork repo).

## Global Constraints

- The maintainer never deploys: no SSH keys, no host Docker socket, no access to homelab (`192.168.1.92`) or `192.168.1.0/24`.
- Never pushes to `nsfw`; only branches `nsfw-vX.Y.Z` + PR into `nsfw` (tests: PR base `nsfw-test`).
- GitHub credential = the user's existing `gh` token (no new PAT). It lives ONLY in the `publisher` container (secret file `secrets/github_token`, from `gh auth token`, mode 600, never printed). The `agent` container (where opencode runs) never has it. `publisher` pushes only refs matching `^nsfw-v\d+\.\d+\.\d+$` or `^nsfw-test-[\w.-]+$` and opens/closes PRs only in `WalidOA27/immich`.
- `dind` is NOT privileged: `cap_add: [ALL]`, `security_opt: [seccomp=unconfined, apparmor=unconfined, systempaths=unconfined]`, `cgroup: private`, entrypoint `sh -c 'umount /sys/fs/cgroup && mount -t cgroup2 none /sys/fs/cgroup && exec dockerd-entrypoint.sh'`, `DOCKER_TLS_CERTDIR=""`. Verified on archD 2026-11-08: inner containers run, and neither dind nor an inner `--privileged` container can read the host disk (`mknod b 259 4` → read denied).
- Idle check (no new release) makes no LLM call.
- "New" = latest non-prerelease, non-draft upstream tag newer than `Base:` in `FORK.md` on `nsfw`, not already in the state file.
- Check on start, then every 6 h. Caps: 3 builder rounds, 6 h wall clock per release; on cap → draft PR marked failed + notify; failed release not retried until a newer release or state cleared.
- Notifications: `notify-send` via `/run/user/1000/bus`; start "Mantenimiento Immich: empieza vX.Y.Z"; end "listo: PR #N" / "necesita ayuda: <motivo>"; failure to notify never fails a run.
- Builder must not edit `misc/nsfw/verify.sh`, `invariants.sh`, `e2e.sh`, `machine-learning/`, migrations; must not reduce `it(`/`test(`/`expect` counts; no `.skip`/`.only`/`todo`.
- Out-of-inventory files (vs. pre-run `FORK.md`) → PR title prefix `⚠ inventario ampliado`, not a failure.
- Newer release supersedes an open earlier maintainer PR (close with link, keep branch). Every run starts from `nsfw`.
- Limits: `agent` 4 CPU / 8 GB, `dind` 4 CPU / 8 GB; require ≥ 40 GB free on `/`; `out/` keeps last 2 tars; prune dind after runs except ML image + model cache.
- opencode key never printed or logged (scrub any `oc_sk_` / `sk-` token from logs).
- Model: `opencode-go/deepseek-v4.1-flash` for both roles.

## Review Focus

- GitHub API down / rate-limited / malformed JSON during the 6 h check → log, no crash, try next cycle (test in Task 3).
- Upstream tags like `v3.4.0-rc.1`, `v4.0.0-beta`, drafts, or a tag older than base → ignored (test in Task 3).
- opencode exits non-zero, prints non-JSON, or hangs → counts as one failed round; per-call timeout 45 min (test in Task 5).
- Container killed mid-`prepare` (half-done rebase, dirty tree) → on resume `prepare` aborts any rebase and resets the clone before redoing; it's idempotent (test in Task 4 + Task 5).
- Disk fills or dind dies mid-run → node raises, run ends as "necesita ayuda", state records failure, no tight retry loop (test in Task 4).

---

### Task 1: Fork gate — `invariants.sh` and `Base:` line

Repo: `~/immich-fork`, branch `nsfw`.

**Files:**
- Create: `misc/nsfw/invariants.sh`, `misc/nsfw/test-invariants.sh`
- Modify: `FORK.md` (add `Base: v3.3.6` line under the title; list the two new files and `e2e.sh`)

**Interfaces:**
- Produces: `misc/nsfw/invariants.sh <pre_run_ref> <upstream_tag>` — exit 0 ok, exit 1 violation (one `VIOLATION: <reason>` line each on stdout), always prints `OUT_OF_INVENTORY: <path>` lines for files changed vs `<upstream_tag>` not named in `FORK.md` at `<pre_run_ref>` (not a failure). Reads gate scripts and `FORK.md` from `<pre_run_ref>` via `git show`, not the working tree.
- Produces: `FORK.md` line matching `^Base: (v\d+\.\d+\.\d+)$`.

- [ ] **Step 1: Write `test-invariants.sh`** — builds a temp git repo (upstream commit with a spec of 3 `it(`/5 `expect`, tag `vT`; fork commit with `FORK.md` + gate scripts = `pre`), then one case per check, each on a fresh branch from `pre`, asserting exit code and output:
  - clean change to an inventoried file → exit 0, no output
  - edit `misc/nsfw/verify.sh` → exit 1, `VIOLATION: gate script modified: misc/nsfw/verify.sh`
  - touch `machine-learning/x.py` → `VIOLATION: machine-learning changed`
  - add `server/src/schema/migrations/1-x.ts` → `VIOLATION: migration added`
  - delete one `it(` in a fork-touched spec → `VIOLATION: test count dropped in <file>`; delete one `expect(` → `VIOLATION: expect count dropped in <file>`
  - add `it.skip(` / `.only(` / `it.todo(` → `VIOLATION: skip/only/todo in <file>`
  - new file `server/src/foo.ts` not in inventory, with that file also added to `FORK.md` in the working branch → exit 0 and `OUT_OF_INVENTORY: server/src/foo.ts` (proves the pre-run `FORK.md` is used)
- [ ] **Step 2: Run** `bash misc/nsfw/test-invariants.sh` → FAIL (script missing).
- [ ] **Step 3: Implement `invariants.sh`.** Counts are computed per spec file as `count(working tree) - count(upstream_tag)` vs `count(pre_run_ref) - count(<pre_run_ref's Base tag>)`, i.e. the fork's own delta must not shrink (upstream changes excluded). Inventory = backticked paths in `FORK.md`'s tables at `pre_run_ref`. Ignore the generated files listed in `FORK.md`.
- [ ] **Step 4: Run** `bash misc/nsfw/test-invariants.sh` → all `ok`; then on the real repo `misc/nsfw/invariants.sh HEAD v3.3.6` → exit 0, no output.
- [ ] **Step 5: Add `Base: v3.3.6` + inventory rows to `FORK.md`; commit** `feat(nsfw): invariants gate for automated maintenance`.

### Task 2: Fork gate — repeatable `e2e.sh`

**Files:**
- Create: `misc/nsfw/e2e.sh`
- Modify: `misc/nsfw/docker-compose.test.yml` (ML image tag from `${ML_IMAGE_TAG:-v3.3.6}`; data dir from `${NSFW_TEST_DIR:-$HOME/immich-nsfw-test}`; port from `${NSFW_TEST_PORT:-2284}`)

**Interfaces:**
- Consumes: image `immich-server:nsfw-<tag>` (from `build.sh`).
- Produces: `misc/nsfw/e2e.sh` — env `NSFW_IMAGE`, `ML_IMAGE_TAG`; brings the stack up (project `immich-nsfw-e2e`), tears it down and deletes its data via a container on exit (trap), prints `e2e: OK` and exits 0, or `e2e: FAIL <check>` exit 1. Total timeout 25 min.

- [ ] **Step 1:** Port the scratch flow (`$SCRATCH/tools/e2e.sh`: admin sign-up, upload, Smart Search → Missing, poll scores) into `e2e.sh`, generating 10 images with Pillow inside `python:3.12-slim` (random colour fields + shapes, 512×512 webp) — no stored images.
- [ ] **Step 2:** Checks, each a named `FAIL`: `scores` (10 rows, `v=1`, score ∈ [0,1], within 15 min); `threshold0` (restart server with `IMMICH_NSFW_THRESHOLD=0`: buckets `withoutNsfw=true` total 0, bucket `isNsfw` all true); `threshold1` (`=1`: `withoutNsfw` total = 10 minus count of scores equal to 1); `missing` (Missing leaves max `updatedAt` unchanged); `all` (All advances it).
- [ ] **Step 3: Run** `misc/nsfw/build.sh && NSFW_IMAGE=immich-server:nsfw-v3.3.6 misc/nsfw/e2e.sh` → `e2e: OK`; then sabotage check: run with `NSFW_IMAGE=ghcr.io/immich-app/immich-server:v3.3.6` (official) → `e2e: FAIL scores`.
- [ ] **Step 4: Commit** `feat(nsfw): repeatable e2e gate`; push `nsfw`.

### Task 3: Maintainer repo, release detection, state, notify, disk

Repo: new `~/immich-maintainer` (private `WalidOA27/immich-maintainer`, created with `gh repo create --private`).

**Files:**
- Create: `pyproject.toml`, `maintainer/releases.py`, `maintainer/state.py`, `maintainer/notify.py`, `maintainer/disk.py`, `maintainer/logs.py`, `tests/test_releases.py`, `tests/test_state.py`, `tests/test_notify.py`, `tests/test_logs.py`

**Interfaces:**
- Produces:
  - `parse_base(fork_md: str) -> str` (raises `ValueError` if no `Base:` line)
  - `pick_release(releases: list[dict], base: str) -> str | None` — GitHub `/repos/immich-app/immich/releases` items; skips `draft`, `prerelease`, tags not `^v\d+\.\d+\.\d+$`; returns highest tag > base.
  - `fetch_releases(client: httpx.Client) -> list[dict] | None` — `None` on any HTTP/JSON error (logged).
  - `State(path: Path)` JSON file: `.get(tag) -> dict | None`, `.set(tag, status: Literal["running","done","failed"], **info)`; atomic write (tmp + rename).
  - `notify(title: str, body: str) -> None` — runs `notify-send -a "Immich maintainer"`; swallows every error; no-op if `DBUS_SESSION_BUS_ADDRESS` socket missing.
  - `enough_disk(path: str = "/out", min_gb: int = 40) -> bool` (`/out` is a bind mount on archD's `/`, so `statvfs` measures `/`)
  - `scrub(text: str) -> str` — replaces `oc_sk_\w+`, `sk-\w{8,}`, `github_pat_\w+`, `ghp_\w+` with `***`; `setup_logging()` installs a filter applying it.

- [ ] **Step 1: Write tests** — `pick_release`: picks `v3.4.0` over `v3.3.7` given base `v3.3.6`; ignores `v3.5.0-rc.1`, drafts, prerelease flag; returns `None` when newest ≤ base; numeric compare (`v3.10.0` > `v3.9.0`). `fetch_releases` with `httpx.MockTransport` returning 500, 403 rate-limit and `"not json"` → `None`. `parse_base` happy/missing. `State` round-trip and survives a crash between tmp write and rename (old content intact). `notify` with missing bus → returns, no exception; with `notify-send` absent from PATH → no exception. `scrub` on each token form.
- [ ] **Step 2: Run** `pytest -q` → FAIL (imports).
- [ ] **Step 3: Implement** the modules.
- [ ] **Step 4: Run** `pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat: release detection, state, notify, disk, log scrubbing`.

### Task 4: The graph (with fakes)

**Files:**
- Create: `maintainer/graph.py`, `maintainer/ports.py`, `tests/fakes.py`, `tests/test_graph.py`

**Interfaces:**
- Consumes: Task 3 `State`, `notify`.
- Produces (`ports.py`, `typing.Protocol`s):
  - `Repo.prepare(tag: str, old_base: str) -> PrepareResult(conflicts: list[str], ok: bool)` — idempotent.
  - `Gates.run(tag: str) -> GateResult(passed: bool, log: str, out_of_inventory: list[str])`
  - `Llm.build(ctx: BuildCtx) -> str` (summary), `Llm.verify(ctx: VerifyCtx) -> Verdict(approve: bool, reasons: str)`; both raise `LlmError` on failure/timeout.
  - `Publisher.publish(tag: str, body: str, title: str, draft: bool) -> int` (PR number; supersedes older open maintainer PRs). The branch name is `nsfw-<tag>` (or `nsfw-test-<tag>` when `--pr-base` is not `nsfw`).
  - `Imager.build_and_save(tag: str) -> Path`
- Produces (`graph.py`): `build_graph(ports: Ports, checkpointer) -> CompiledGraph`; `run_release(tag, old_base, ports, db_path) -> RunOutcome(status: Literal["done","failed"], pr: int | None, reason: str)`; thread id = tag, so re-invoking with the same tag resumes.
- Graph state: `tag, old_base, round (0..3), conflicts, gate_log, verdict, summaries: list[str], out_of_inventory, started_at, pr, status, reason`.
- Routing: prepare → (conflicts → builder | gates); gates fail → builder (if round < 3 and elapsed < 6 h) else publish(draft); gates pass → verifier; verifier reject → builder (same caps) ; approve → publish → image → end. `LlmError` counts as a used round. Any other exception in a node → end with `failed`, reason = exception class + message (scrubbed).

- [ ] **Step 1: Write `test_graph.py`** with scripted fakes:
  - happy path: no conflicts, gates pass, approve → `done`, PR non-draft, title without `⚠`, image built, notify called with start then "listo: PR #<n>".
  - gates fail twice then pass → builder called 2×, `done`.
  - gates always fail → builder 3×, PR `draft=True`, outcome `failed`, notify "necesita ayuda".
  - verifier rejects then approves → builder called with the rejection reasons in `ctx`.
  - `Llm.build` raises `LlmError` 3× → `failed`, draft PR.
  - out-of-inventory `["server/src/foo.ts"]` → PR title starts `⚠ inventario ampliado`, body lists the file.
  - `Imager` raises `OSError("No space left")` → `failed`, reason contains "No space left", notify "necesita ayuda".
  - resume: fake `Gates.run` raises `KeyboardInterrupt`-like `SystemExit` on first call; re-run `run_release` same tag/db → prepare not called again, gates called again, ends `done`.
  - wall clock: `started_at` 7 h ago with failing gates → no builder call, straight to draft.
- [ ] **Step 2: Run** `pytest tests/test_graph.py -q` → FAIL.
- [ ] **Step 3: Implement** `graph.py` with `langgraph.graph.StateGraph` and `SqliteSaver.from_conn_string(db_path)`.
- [ ] **Step 4: Run** `pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat: maintenance graph with checkpointed resume`.

### Task 5: Real adapters

**Files:**
- Create: `maintainer/adapters/repo.py`, `gates.py`, `llm.py`, `publisher.py`, `imager.py`, `maintainer/publisher_app.py`, `prompts/builder.md`, `prompts/verifier.md`, `tests/test_repo_adapter.py`, `tests/test_llm_adapter.py`, `tests/test_publisher.py`

**Interfaces:**
- Consumes: Task 4 ports; Task 1/2 scripts in the clone.
- Produces: `GitRepo(clone: Path)`, `ShellGates(clone)`, `OpencodeLlm(clone, model="opencode-go/deepseek-v4.1-flash", timeout_s=2700)`, `RemotePublisher(url="http://publisher:8080", handoff: Path)` (agent side: `git push` the branch to the shared bare repo `handoff` volume, then `POST /publish {branch, base, title, body, draft}` → `{pr}`), `publisher_app` (`maintainer/publisher_app.py`, runs in the `publisher` container: validates branch against the ref allowlist and `base ∈ {nsfw, nsfw-test}`, pushes that single ref from the bare repo to `https://github.com/WalidOA27/immich` with the token via `GIT_ASKPASS`, opens the PR via REST, closes superseded open PRs from `nsfw-v*` branches with a comment linking the new one; never pushes any other ref; rejects with 400 otherwise), `LocalPublisher(bare_remote: Path)`, `DindImager(clone, out_dir, keep=2)`.

- [ ] **Step 1: Tests** —
  - `GitRepo` on a temp repo pair (upstream with tags `vA`,`vB`; fork branch `nsfw` on `vA`): clean rebase → `ok`, branch `nsfw-vB` exists; conflict in a generated-file path (`open-api/immich-openapi-specs.json`) → resolved to upstream automatically, not in `conflicts`; conflict in code → listed in `conflicts`, tree left with markers for the builder; calling `prepare` again after a simulated crash (`.git/rebase-merge` present, dirty tree) → aborts, resets, same result. `rerere.enabled=true` set on the clone.
  - `OpencodeLlm` with a fake `opencode` script on PATH: exit 1 → `LlmError`; non-JSON → `LlmError`; sleep beyond `timeout_s=1` → `LlmError`; verifier output containing `VERDICT: APPROVE` / `VERDICT: REJECT\n<reasons>` parsed. Command line asserted: `opencode run --model opencode-go/deepseek-v4.1-flash --format json --auto --title "<role> <tag> r<n>"`; verifier uses `--agent plan` (read-only).
  - `publisher_app` with `httpx.MockTransport` + temp bare repo: valid request pushes only that ref then `POST /pulls` with `base`, `draft`; with an open PR from branch `nsfw-vOLD` → `PATCH state=closed` + comment linking the new PR; branch `nsfw`, `main`, `nsfw-v3.3.7;rm` or base `main` → 400 and no push; token never appears in responses or logs.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Notes:
  - `GitRepo.prepare`: `git fetch upstream --tags`, `git checkout -B nsfw-<tag> origin/nsfw`, `git rebase --onto <tag> <old_base>`; regenerate generated files after a successful rebase using `FORK.md`'s commands (run with `MISE_LOCKED=1`, Postgres for `mise run sql` from dind via testcontainers-free `docker run` of the Immich Postgres image); update `Base:` line in `FORK.md`; commit.
  - `ShellGates.run`: `verify.sh`, then `invariants.sh <pre-run sha of origin/nsfw> <tag>`, then `build.sh` + `e2e.sh`; stop at first failure; `DOCKER_HOST=tcp://dind:2375`; logs scrubbed and tail-truncated to 400 lines.
  - Prompts carry the forbidden-edits list from Global Constraints verbatim, `FORK.md`, the spec path, the gate log, previous verifier reasons. Builder commits its work (`fix(nsfw): adapt to <tag>`).
  - PR body: upstream release link, conflicts, builder summaries, verdict, gate summary, out-of-inventory list, and the deploy hint `ssh homelab docker load < out/immich-server-nsfw-<tag>.tar`.
  - `DindImager`: `build.sh`, `docker save` to `out/immich-server-nsfw-<tag>.tar`, delete older tars beyond `keep`, `docker image prune -f && docker builder prune -f --filter until=24h`.
- [ ] **Step 4: Run** `pytest -q` → PASS.
- [ ] **Step 5: Commit** `feat: git, gates, opencode, github and image adapters`.

### Task 6: Supervisor, container, compose, firewall

**Files:**
- Create: `maintainer/main.py`, `tests/test_main.py`, `Dockerfile`, `docker-compose.yml`, `entrypoint.sh`, `host/immich-maintainer-fw.service`, `host/fw.sh`, `secrets/.gitignore`, `README.md`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: `python -m maintainer.main` — loop: if a state entry is `running` → `run_release` it (resume); else `fetch_releases` → `pick_release` → skip if state has it → disk check (notify + skip if low) → `run_release`; record outcome; sleep 6 h. Flags: `--once`; `--tag vX.Y.Z` (force a target); `--fork-branch NAME` (default `nsfw`; base read from its `FORK.md`); `--pr-base NAME` (default `nsfw`); `--local-remote PATH` (use `LocalPublisher`).

- [ ] **Step 1: `test_main.py`** (`--once`, fakes): no new release → `run_release` not called and no `Llm` constructed; state `running` for `v3.3.7` → resumed first; tag with state `failed` → skipped; low disk → notify once, no run; `fetch_releases` returns `None` → no crash.
- [ ] **Step 2: Run** → FAIL; **Step 3: Implement**; **Step 4: Run** → PASS.
- [ ] **Step 5: Container.** `Dockerfile` (`python:3.12-slim` + git, docker CLI, `libnotify-bin`, ImageMagick, mise, opencode 2.2.5, `uv pip install .`), non-root user uid 1000. `docker-compose.yml`:
  - network `maint` with fixed subnet `172.31.250.0/24`;
  - `agent`: (also verify inside agent: no file contains the GitHub token — `grep -r` for its prefix over `/` excluding `/proc`) `restart: unless-stopped`, `cpus: 4`, `mem_limit: 8g`, volumes `work:/work` (clone + state + `checkpoints.sqlite`), `./out:/out`, `/run/user/1000/bus:/run/user/1000/bus` (no other host paths: never mount `/` or `$HOME`, which hold SSH keys), secret `opencode_auth` (a generated `auth.json` containing only the `opencode-go` entry), volume `handoff:/handoff`; NO GitHub token; env `DOCKER_HOST=tcp://dind:2375`, `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`;
  - `dind`: `docker:29-dind`, unprivileged config from Global Constraints, `restart: unless-stopped`, `cpus: 4`, `mem_limit: 8g`, volume `dind:/var/lib/docker`, not exposed on the host.
  - `publisher`: same image, command `python -m maintainer.publisher_app`, `restart: unless-stopped`, `cpus: 0.5`, `mem_limit: 256m`, secret `github_token`, volume `handoff:/handoff:ro`, port 8080 only on the `maint` network.
  - `host/fw.sh` installs `DOCKER-USER` rules: drop from `172.31.250.0/24` (and dind's inner bridge, masqueraded through it) to `192.168.1.0/24`; `immich-maintainer-fw.service` (`After=docker.service`, `PartOf=docker.service`, oneshot, `RemainAfterExit`).
- [ ] **Step 6: Verify** `docker compose build && docker compose up -d`; inside agent: `curl -m5 http://192.168.1.92` fails; `curl -m5 https://api.github.com` works; `ls /var/run/docker.sock` absent; `ls ~/.ssh` absent; `notify-send test` shows on KDE.
- [ ] **Step 7: Commit + push** `feat: supervisor and container stack`.

### Task 7: One-time setup and acceptance

- [ ] **Step 1:** `umask 077; gh auth token > ~/immich-maintainer/secrets/github_token` (never echo it).
- [ ] **Step 2:** create branch `nsfw-test` on `WalidOA27/immich` (from `nsfw`). No ruleset (an admin token bypasses it; the publisher allowlist is the guard).
- [ ] **Step 3:** `sudo install` + `systemctl enable --now immich-maintainer-fw`; reboot-free check: `iptables -S DOCKER-USER` shows the rules.
- [ ] **Step 4: Replay.** Build `replay` setup: branch `nsfw-replay-base` = `nsfw` rebased onto `v3.3.5` (done by hand, `Base: v3.3.5`), run `python -m maintainer.main --once --tag v3.3.6 --fork-branch nsfw-replay-base --pr-base nsfw-test` → PR into `nsfw-test` green, tar in `out/`, two notifications.
- [ ] **Step 5: Broken case.** Same, with a commit on `nsfw-replay-base` that renames the `withoutNsfw` option use in `asset.repository.ts` so it no longer compiles → builder fixes it within 3 rounds, or draft PR + "necesita ayuda".
- [ ] **Step 6: Resume.** Start the replay, `docker kill` the agent during `gates`; `docker compose up -d` → log shows resume at `gates`, finishes.
- [ ] **Step 7: Idle.** `--once` with real state → finishes < 30 s, opencode not invoked (no new session in its log).
- [ ] **Step 8:** Close test PRs, delete `nsfw-test`/replay branches, clear test state, leave the stack running. Update memory `immich-nsfw-fork.md` with the maintainer location and how to read its state.
