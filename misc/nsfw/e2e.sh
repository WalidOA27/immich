#!/usr/bin/env bash
# End-to-end gate for the NSFW fork: brings up a throwaway stack (misc/nsfw/docker-compose.test.yml, project
# immich-nsfw-e2e), uploads 10 generated images and checks scoring, the threshold filter and the job commands.
# Prints "e2e: OK" (exit 0) or "e2e: FAIL <check>" (exit 1). Always tears the stack down (incl. volumes) on exit.
# Env: NSFW_IMAGE (default immich-server:nsfw-v3.3.6), ML_IMAGE_TAG (default v3.3.6),
#      NSFW_TEST_PORT (2284), NSFW_TEST_BIND (127.0.0.1; compose port bind), NSFW_TEST_HOST (127.0.0.1; host used for API calls).
# Works with a remote docker daemon: from a container with DOCKER_HOST=tcp://dind:2375 use
#   NSFW_TEST_BIND=0.0.0.0 NSFW_TEST_HOST=dind misc/nsfw/e2e.sh
# The ML model cache lives in the external volume immich-nsfw-e2e-model-cache (created here, kept across runs;
# for manual compose use create it first).
# Requires: docker compose, curl, python3, ImageMagick (magick or convert).
set -uo pipefail
# Hard cap: re-exec under timeout (TERM triggers the EXIT trap, which tears the stack down).
if [[ -z "${NSFW_E2E_INNER:-}" ]]; then
  NSFW_E2E_INNER=1 exec timeout 1500 "$0" "$@"
fi
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

export NSFW_IMAGE="${NSFW_IMAGE:-immich-server:nsfw-v3.3.6}"
export ML_IMAGE_TAG="${ML_IMAGE_TAG:-v3.3.6}"
export NSFW_TEST_PORT="${NSFW_TEST_PORT:-2284}"
export NSFW_TEST_BIND="${NSFW_TEST_BIND:-127.0.0.1}"
HOST="${NSFW_TEST_HOST:-127.0.0.1}"
API="http://$HOST:$NSFW_TEST_PORT/api"
N=10
DEADLINE=$((SECONDS + 24 * 60))
DC=(docker compose -p immich-nsfw-e2e -f misc/nsfw/docker-compose.test.yml)
TMP="$(mktemp -d)"

cleanup() { "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT
trap 'echo "e2e: FAIL interrupted/timeout"; exit 1' INT TERM
fail() { echo "e2e: FAIL $1${2:+ ($2)}"; exit 1; }
left() { (( DEADLINE - SECONDS > 0 )) || fail timeout "25 min total exceeded"; }
j() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
db() { docker exec "$("${DC[@]}" ps -q database)" psql -U postgres -d immich -At "$@"; }
api() { curl -fsS --max-time 60 -H "Authorization: Bearer $TOKEN" "$@"; }
job() { api -X PUT -H 'Content-Type: application/json' -d "{\"command\":\"start\",\"force\":$2}" "$API/jobs/$1" >/dev/null; }
wait_ping() {
  for _ in $(seq 120); do curl -fs --max-time 5 "$API/server/ping" >/dev/null 2>&1 && return 0; sleep 3; left; done
  fail startup "server did not answer ping"
}
nsfw_total() { api "$API/timeline/buckets?$1" | j "sum(b['count'] for b in d)"; }

MAGICK=magick; command -v magick >/dev/null || MAGICK=convert
echo "== generating $N images"
for i in $(seq $N); do
  "$MAGICK" -size 512x512 "xc:rgb($((RANDOM % 256)),$((RANDOM % 256)),$((RANDOM % 256)))" \
    -fill "rgb($((RANDOM % 256)),$((RANDOM % 256)),$((RANDOM % 256)))" -draw "circle $((100 + RANDOM % 300)),$((100 + RANDOM % 300)) 256,$((RANDOM % 512))" \
    -fill "rgb($((RANDOM % 256)),$((RANDOM % 256)),$((RANDOM % 256)))" -draw "rectangle $((RANDOM % 200)),$((RANDOM % 200)) $((250 + RANDOM % 260)),$((250 + RANDOM % 260))" \
    "$TMP/img$i.webp" || fail setup "image generation"
done

echo "== starting stack ($NSFW_IMAGE)"
docker volume inspect immich-nsfw-e2e-model-cache >/dev/null 2>&1 || docker volume create immich-nsfw-e2e-model-cache >/dev/null || fail startup "model cache volume"
"${DC[@]}" down -v --remove-orphans >/dev/null 2>&1
IMMICH_NSFW_THRESHOLD=0.5 "${DC[@]}" up -d >/dev/null 2>&1 || fail startup "compose up"
wait_ping
curl -fs -X POST "$API/auth/admin-sign-up" -H 'Content-Type: application/json' \
  -d '{"email":"admin@nsfw.test","password":"nsfw-test-pass","name":"Admin"}' >/dev/null || true
TOKEN=$(curl -fs -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@nsfw.test","password":"nsfw-test-pass"}' | j "d['accessToken']") || fail startup "login"

echo "== uploading"
for f in "$TMP"/*.webp; do
  api -F "assetData=@$f" -F fileCreatedAt=2024-01-15T10:00:00.000Z -F fileModifiedAt=2024-01-15T10:00:00.000Z \
    -F "filename=$(basename "$f")" "$API/assets" >/dev/null || fail upload "$f"
done

# Uploads made before ML is ready fail smart search upstream-style; the wait loop below reruns it (Missing) until scored.

echo "== waiting for NSFW scores (first run downloads models, can take minutes)"
n=0
for k in $(seq 180); do   # 15 min
  (( k % 12 == 1 )) && job smartSearch false 2>/dev/null || true   # retry: upload-time jobs can fail before ML/model is ready
  n=$(db -c "select count(*) from asset_metadata where key='nsfw'" 2>/dev/null) || n=0
  [[ "$n" -ge "$N" ]] && break
  sleep 5; left
done
[[ "$n" -ge "$N" ]] || fail scores "only $n/$N scores within 15 min"

bad=$(db -c "select count(*) from asset_metadata where key='nsfw' and not ((value->>'v')::int = 1 and (value->>'score')::float between 0 and 1)") || fail scores "db read failed"
total=$(db -c "select count(*) from asset_metadata where key='nsfw'") || fail scores "db read failed"
[[ "$total" == "$N" && "$bad" == "0" ]] || fail scores "rows=$total invalid=$bad"
db -F' ' -c "select a.\"originalFileName\", round((m.value->>'score')::numeric,3) from asset a join asset_metadata m on m.\"assetId\"=a.id and m.key='nsfw' order by 1"

# Missing must not rescore, All must (checked before the threshold restarts; ML is warm now).
q="select max(\"updatedAt\") from asset_metadata where key='nsfw'"
queue_idle() {
  for _ in $(seq 60); do
    busy=$(api "$API/jobs" | j "(lambda c: c['active']+c['waiting'])(d['nsfwDetection']['jobCounts'])") || return 1
    [[ "$busy" == 0 ]] && return 0; sleep 2
  done
  return 1
}
before=$(db -c "$q") && [[ -n "$before" ]] || fail missing "cannot read updatedAt"
job nsfwDetection false || fail missing "job trigger"
sleep 3; queue_idle || fail missing "queue did not go idle"
mid=$(db -c "$q") || fail missing "cannot read updatedAt"
[[ "$before" == "$mid" ]] || fail missing "updatedAt changed: $before -> $mid"
job nsfwDetection true || fail all "job trigger"
advanced=no
for _ in $(seq 45); do
  [[ "$(db -c "select '$(db -c "$q")'::timestamptz > '$mid'::timestamptz")" == t ]] && { advanced=yes; break; }
  sleep 2
done
[[ "$advanced" == yes ]] || fail all "updatedAt did not advance from $mid"
queue_idle || fail all "queue did not go idle"

# Discriminating check: plant the fixture's high-score embedding into one asset and require the real score.
echo "== fixture"
read -r FIX_SCORE FIX_EMB < <(python3 -I -c "
import json
d = json.load(open('server/src/nsfw/nsfw.fixture.json'))
c = max(d['cases'], key=lambda c: c['score'])
print(c['score'], '[' + ','.join(repr(x) for x in c['embedding']) + ']')") || fail fixture "cannot read fixture"
[[ -n "${FIX_SCORE:-}" && -n "${FIX_EMB:-}" ]] || fail fixture "empty fixture"
ASSET=$(db -c "select \"assetId\" from asset_metadata where key='nsfw' order by \"assetId\" limit 1") && [[ -n "$ASSET" ]] || fail fixture "no asset"
upd=$(db -c "with u as (update smart_search set embedding = '$FIX_EMB' where \"assetId\" = '$ASSET' returning 1) select count(*) from u") && [[ "$upd" == 1 ]] || fail fixture "embedding update failed"
job nsfwDetection true || fail fixture "job trigger"
ok=no
for _ in $(seq 45); do
  [[ "$(db -c "select abs((value->>'score')::float - $FIX_SCORE) < 1e-3 from asset_metadata where key='nsfw' and \"assetId\"='$ASSET'")" == t ]] && { ok=yes; break; }
  sleep 2
done
[[ "$ok" == yes ]] || fail fixture "stored score $(db -c "select value->>'score' from asset_metadata where key='nsfw' and \"assetId\"='$ASSET'"), want $FIX_SCORE"
queue_idle || fail fixture "queue did not go idle"
hidden=$(nsfw_total withoutNsfw=true) || fail fixture "timeline request"
[[ "$hidden" == $((N - 1)) ]] || fail fixture "withoutNsfw total=$hidden at threshold 0.5, want $((N - 1))"
flagged=$(api "$API/timeline/bucket?timeBucket=2024-01-01" | j "'%d:%s' % (sum(d['isNsfw']), ','.join(i for i, f in zip(d['id'], d['isNsfw']) if f))") || fail fixture "bucket request"
[[ "$flagged" == "1:$ASSET" ]] || fail fixture "isNsfw flagged=$flagged, want 1:$ASSET"

set_threshold() {
  echo "== IMMICH_NSFW_THRESHOLD=$1"
  IMMICH_NSFW_THRESHOLD="$1" "${DC[@]}" up -d server >/dev/null 2>&1 || fail "$2" "compose up server"
  sleep 5; wait_ping
  TOKEN=$(curl -fs -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"admin@nsfw.test","password":"nsfw-test-pass"}' | j "d['accessToken']") || fail "$2" "login"
}

set_threshold 0 threshold0
t=$(nsfw_total withoutNsfw=true) || fail threshold0 "timeline request"
[[ "$t" == 0 ]] || fail threshold0 "withoutNsfw total=$t, want 0"
flags=$(api "$API/timeline/bucket?timeBucket=2024-01-01" | j "'%d/%d' % (sum(d['isNsfw']), len(d['isNsfw']))") || fail threshold0 "bucket request"
[[ "$flags" == "$N/$N" ]] || fail threshold0 "isNsfw true=$flags"

set_threshold 1 threshold1
ones=$(db -c "select count(*) from asset_metadata where key='nsfw' and (value->>'score')::float = 1") && [[ "$ones" =~ ^[0-9]+$ ]] || fail threshold1 "cannot count score==1 rows"
t=$(nsfw_total withoutNsfw=true) || fail threshold1 "timeline request"
[[ "$t" == $((N - ones)) ]] || fail threshold1 "withoutNsfw total=$t, want $((N - ones))"

echo "e2e: OK"
