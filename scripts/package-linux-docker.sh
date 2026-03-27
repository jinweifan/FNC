#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGE="fncviewer-linux-builder:jammy"

docker build -f "${REPO_ROOT}/docker/linux-builder-jammy.Dockerfile" -t "${IMAGE}" "${REPO_ROOT}"
docker run --rm \
  -v "${REPO_ROOT}:/work" \
  -w /work \
  "${IMAGE}" \
  bash -lc "npm ci && npm run package:linux"
