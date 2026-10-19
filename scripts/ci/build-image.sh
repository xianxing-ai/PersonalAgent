#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_CONTEXT:?Missing allowlist image context}"
: "${IMAGE_RUNNER:?Missing image runner selection}"
image="personalagent-ci:$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
trap 'docker image rm "$image" >/dev/null 2>&1 || true' EXIT
args=()
if [[ "$IMAGE_RUNNER" == self-hosted ]]; then
  # ECR hosts Docker Official Images and is reachable from this ECS.
  # Keep the exact Dockerfile version and immutable digest.
  base=$(sed -n 's|^ARG NODE_BASE_IMAGE=node:|public.ecr.aws/docker/library/node:|p' "$IMAGE_CONTEXT/Dockerfile")
  [[ "$base" =~ ^public\.ecr\.aws/docker/library/node:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$ ]]
  args+=(--build-arg "NODE_BASE_IMAGE=$base")
fi
docker build --platform linux/arm64 "${args[@]}" --tag "$image" "$IMAGE_CONTEXT"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = linux/arm64
