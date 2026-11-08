#!/usr/bin/env bash
# Builds the fork's server image (web included). Usage: misc/nsfw/build.sh [tag]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BASE="$(git describe --tags --abbrev=0)"
TAG="${1:-immich-server:nsfw-${BASE}}"
DOCKER_BUILDKIT=1 docker build -f server/Dockerfile -t "$TAG" .
echo "built $TAG"
