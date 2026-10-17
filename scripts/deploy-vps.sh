#!/usr/bin/env bash
# Run on the VPS over SSH. Secrets stay in /opt/flowdesk/shared/.env.
set -euo pipefail
commit="${1:?Commit SHA required}"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
root=/opt/flowdesk
release="$root/releases/$commit"
archive="$HOME/flowdesk-$commit.tar.gz"
test -s "$root/shared/.env"
test -f "$archive"
mkdir -p "$release"
tar -xzf "$archive" -C "$release"
ln -sfn "$root/shared/.env" "$release/.env"
previous="$(readlink -f "$root/current" 2>/dev/null || true)"
compose() { docker compose --project-name flowdesk --env-file "$root/shared/.env" --project-directory "$1" -f "$1/docker-compose.yml" "${@:2}"; }
if compose "$release" up -d --build --wait --wait-timeout 180; then
  ln -sfn "$release" "$root/current"
  printf 'Deployed commit %s\n' "$commit"
else
  echo 'Deployment failed; restoring previous release when available' >&2
  if [ -n "$previous" ] && [ -f "$previous/docker-compose.yml" ]; then
    compose "$previous" up -d --build --wait --wait-timeout 180 || echo 'Rollback needs operator attention' >&2
  fi
  exit 1
fi
