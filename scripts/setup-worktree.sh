#!/usr/bin/env bash
set -euo pipefail

worktree_root=$(git rev-parse --show-toplevel)
common_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd -P)
source_root=$(dirname "$common_dir")

if [[ ! -f "$source_root/.git/config" ]]; then
  echo "Cannot locate the main checkout from $common_dir" >&2
  exit 1
fi

if [[ "$worktree_root" != "$source_root" ]]; then
  while IFS= read -r -d '' source; do
    relative_path=${source#"$source_root"/}
    destination="$worktree_root/$relative_path"
    if [[ -L "$destination" ]]; then
      temporary=$(mktemp "${destination}.XXXXXX")
      cp -L "$destination" "$temporary"
      chmod 600 "$temporary"
      mv -f "$temporary" "$destination"
      echo "Replaced shared link with an independent copy: $relative_path"
      continue
    fi
    if [[ -e "$destination" ]]; then
      echo "Skipping existing $relative_path"
      continue
    fi
    mkdir -p "$(dirname "$destination")"
    cp -L "$source" "$destination"
    chmod 600 "$destination"
    echo "Copied $relative_path (independent of the main checkout)"
  done < <(find "$source_root" \( -name .git -o -name node_modules \) -prune -o -name .env.local \( -type f -o -type l \) -print0)
fi

cd "$worktree_root"
if [[ "${1:-}" != "--skip-install" ]]; then
  bun install --frozen-lockfile
fi
