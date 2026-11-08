# Immich fork auto-maintainer — design

Date: 2026-11-08. Fork: `WalidOA27/immich`, branch `nsfw` (see `FORK.md`).

## Intent

Every time upstream Immich publishes a new release, the `nsfw` patch should be carried onto it **without the user
doing anything**, and the result handed back as something the user can review and deploy *when they want*. The fork
was built small precisely so this is feasible.

**The maintainer never touches the user's infrastructure.** The user's words: "nosotros actualizamos nuestra instancia
de immich cuando queramos, el no dicta ni actualiza nuestra infra." This is a hard rule, enforced by what the
maintainer *can* reach, not only by prompts.

## Goals

- Fully autonomous: detects a new release, rebases, fixes breakage, verifies, publishes a PR and a built image.
- Two LLM roles: a **builder** (fixes) and a **verifier** (judges the result), both opencode + DeepSeek V4.1 Flash
  (`deepseek-v4.1-flash`, existing opencode-go key).
- Survives reboots: the container comes up by itself and resumes an interrupted run where it stopped.
- Simple KDE notification when a run starts (and when it ends, see below).

## Non-goals

- Deploying anything, anywhere. No access to homelab, `~/immich-app` or the host Docker.
- Merging into `nsfw`. The user merges the PR.
- Android, new features, upstream contributions, fixing upstream bugs.
- A web dashboard or chat integration (WhatsApp/Hermes excluded).

## Anti-goals (a failure even if it "works")

- The LLM loosens or deletes tests, or edits `verify.sh`/`invariants.sh`/`e2e.sh`, to get green.
- The patch grows: migrations, new tables, changes under `machine-learning/`, or touching files not in `FORK.md`'s
  inventory without the PR saying so loudly.
- Burning tokens when there is nothing to do (the idle check must not call an LLM).
- Leaving archD out of disk (it is at ~91%).

## Constraints (decided)

- **Lives on archD** (8 cores, 28 GB RAM, Docker enabled at boot, opencode v2.2.5 installed). archD is almost always
  on but sometimes off; that's fine.
- **Docker Compose stack, `restart: unless-stopped`**: since Docker starts at boot, the stack starts by itself. No
  systemd timer, no login needed.
- **Wake-up**: a deterministic supervisor loop inside the container: on start (resume any checkpointed run), then
  every 6 h, query the GitHub releases API. "New" = latest non-prerelease, non-draft upstream tag newer than the base
  tag recorded in `FORK.md` and not already processed (state file). No LLM in this path.
- **LangGraph** orchestrates, with a SQLite checkpointer on a volume, so a reboot mid-run resumes at the last node.
- **Notification** via `notify-send` on the user's session bus (`/run/user/1000/bus` mounted, `DBUS_SESSION_BUS_ADDRESS`
  set). If the bus is missing (user not logged in), skip silently; a notification failure never fails a run.

## The run (graph)

1. **prepare** — `git fetch upstream --tags`; new branch `nsfw-vX.Y.Z` from `nsfw`; `git rebase --onto vX.Y.Z
   <old base> ` with `rerere` enabled; on conflicts in generated files take upstream; regenerate generated files
   (`FORK.md` lists commands). Notify: "Mantenimiento Immich: empieza vX.Y.Z".
2. **gates** — deterministic, the only authority on pass/fail: `misc/nsfw/verify.sh`, `misc/nsfw/invariants.sh`,
   `misc/nsfw/e2e.sh` (throwaway instance inside the sandbox).
3. **builder** (only if rebase conflicts or a gate fails) — opencode session with: `FORK.md`, the design spec, the
   failing log, the diff vs upstream. It may edit fork code; it may **not** edit the gate scripts, test expectations
   from upstream, or anything under `machine-learning/` (checked by `invariants.sh` against the pre-run copy of the
   gate scripts). Back to **gates**.
4. **verifier** (when gates pass) — separate opencode session, read-only: reviews the full fork diff against
   `FORK.md`'s intent (still minimal? same behaviour? nothing sneaky to get green?). Returns approve, or reject with
   reasons → back to **builder**. The verifier can block but never overrides a failing gate.
5. **publish** — push `nsfw-vX.Y.Z`, open a PR into `nsfw` with: upstream version, what conflicted, what the LLM
   changed and why, verifier's verdict, gate results. Update the base tag in `FORK.md` within the PR.
6. **image** — build `immich-server:nsfw-vX.Y.Z` (`misc/nsfw/build.sh`) inside the sandbox and `docker save` it to
   `~/immich-maintainer/out/immich-server-nsfw-vX.Y.Z.tar`. The user deploys with
   `ssh homelab docker load < out/…tar` when they choose.
7. **end** — notify "listo: PR #N" or "necesita ayuda: <motivo corto>"; prune sandbox images/volumes.

### What the builder may change

- Allowed: any fork code, and the **fork's own hunks** inside upstream files listed in `FORK.md` — including the fork's
  edits to upstream specs (`job.service.spec.ts`, `queue.service.spec.ts`, `timeline.service.spec.ts`), since new
  releases most often break exactly those.
- Forbidden (hard gate failure): editing `verify.sh`, `invariants.sh`, `e2e.sh`; anything under `machine-learning/`;
  migrations; reducing the number of `it(`/`test(` cases or `expect` calls in any spec file vs. the pre-run state
  (upstream's own changes excluded, measured on the upstream tag); adding `.skip`/`.only`/`todo`.
- Outside the inventory: allowed but **not silent** — `invariants.sh` compares against the `FORK.md` inventory of the
  *pre-run* `nsfw` branch (so the builder adding lines to `FORK.md` doesn't launder it); out-of-inventory files are
  reported, the PR title gets `⚠ inventario ampliado`, the verifier must justify each one. Not a gate failure.

### e2e.sh

Repeatable version of the scratch e2e used on the first build (full flow, not a smoke test): start the throwaway stack
(`docker-compose.test.yml`, real ML image v`X.Y.Z`, CLIP model cache in a persistent dind volume), create admin,
upload ~10 generated images (ImageMagick/Pillow, no real NSFW content — the fork is public), run Smart Search →
Missing (upstream startup race), wait for NSFW scores (timeout 15 min). Then mechanically, independent of content:
every image has an `nsfw` row with `v=1` and a score in [0,1]; with `IMMICH_NSFW_THRESHOLD=0` `withoutNsfw` returns
0 assets and `isNsfw` is all true; with threshold `1` nothing is hidden (unless a score is exactly 1); Missing doesn't
rescore, All does. Model quality isn't the maintainer's job.

### Releases and pending PRs

- `FORK.md` gets a machine-readable line `Base: vX.Y.Z` (the user updates it too if they rebase by hand).
- Every run starts from `nsfw`. If an earlier maintainer PR is still open when a newer release appears, the new PR
  supersedes it: the old one is closed with a comment linking the new one, its branch kept.

Caps: at most 3 builder↔gates/verifier rounds and 6 h wall clock per release; then stop, push the branch as-is as a
**draft** PR marked failed, and notify. A failed release is not retried automatically until a newer release appears
or the user clears its state.

## Isolation and credentials

- Two services: `agent` (supervisor + LangGraph + opencode + mise toolchain; repo clone on a volume) and `dind`
  (Docker-in-Docker for testcontainers Postgres, the e2e instance and the image build). The host Docker socket is
  never mounted. Honest caveat: privileged dind is a guardrail against accidents, not a hard security boundary; the
  real protection is that no credential for anything else exists inside.
- No SSH keys. The agent's network must not reach the LAN (`192.168.1.0/24`, so not homelab); internet only.
- GitHub: fine-grained PAT limited to `WalidOA27/immich` (contents + pull requests write), as a secret file. A
  GitHub ruleset on the fork protects `nsfw` from direct pushes, so the PAT can only create branches/PRs.
- opencode key mounted read-only as a secret; never logged or printed (logs are scrubbed of the key prefix).
- Limits: `agent` 4 CPU / 8 GB, `dind` 4 CPU / 8 GB. Before a run, require ≥ 40 GB free on `/` (124 GB free today);
  otherwise notify and skip until next check. dind's `/var/lib/docker` is a named volume on `/`; after each run prune
  dangling images/build cache but keep the ML image and model cache. `out/` keeps the last 2 tars.

## Setup the user does once (part of the plan)

- Create the fine-grained PAT on GitHub (web UI; Claude can't). Repo creation and the `nsfw` ruleset Claude does with
  the user's `gh` login.

## Code location

- Maintainer code: new private repo `WalidOA27/immich-maintainer`, cloned at `~/immich-maintainer` (compose file,
  supervisor, graph, prompts, tests). Kept out of the fork so the agent never edits its own code.
- Additions to the fork (prerequisites, small, under `misc/nsfw/`): `e2e.sh` (the scratch e2e from the first build,
  made repeatable), `invariants.sh` (no migrations, no `machine-learning/` changes, gate scripts untouched, changed
  files ⊆ `FORK.md` inventory or flagged), and `FORK.md` updates. `rerere` is enabled in the agent's clone.

## Acceptance

- Replay test: a copy of the patch based on **v3.3.5** is fed to the maintainer with target **v3.3.6**; it must
  produce a green PR and an image tar. Publish is pluggable: tests run against a bare git remote inside the sandbox
  (PR step stubbed), plus one real run to `WalidOA27/immich` with PR base `nsfw-test` (not `nsfw`).
- A deliberately broken case (e.g. an injected conflict in `asset.repository.ts`) gets fixed by the builder, or
  ends as a draft PR + "necesita ayuda" notification within the caps.
- Kill the container mid-run (`docker kill`) → on restart it resumes from the checkpoint, not from scratch.
- From inside `agent`: homelab (`192.168.1.92`) unreachable, no host socket, no SSH key.
- Idle check with no new release: no LLM call, finishes in seconds.

## Left to the builder

Supervisor language/libs (Python + LangGraph suggested), how opencode is driven (`opencode run` non-interactive vs
server API), exact prompt wording, LAN egress block mechanism, log format and retention.

## Calls made by Claude (not explicitly decided by the user)

- 6 h check interval; caps of 3 rounds / 6 h; 40 GB free-disk minimum; resource limits.
- An end notification in addition to the start one (user asked only for start; drop it if unwanted).
- Separate private repo for the maintainer; dind sandbox; LAN egress block; ruleset protecting `nsfw`.
- Image delivered as a tar in `~/immich-maintainer/out/`, not loaded into the host Docker; last 2 kept.
- Builder may edit the fork's hunks in upstream specs, but can't reduce test/expect counts; out-of-inventory changes
  are warned in the PR title, not blocked.
- e2e uses generated images and thresholds 0/1 to check the pipeline mechanically.
- A newer release supersedes (closes) an unmerged earlier PR; every run starts from `nsfw`.
