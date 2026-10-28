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
    if [[ -e "$destination" || -L "$destination" ]]; then
      echo "Skipping existing $relative_path"
      continue
    fi
    mkdir -p "$(dirname "$destination")"
    ln -s "$source" "$destination"
    echo "Linked $relative_path"
  done < <(find "$source_root" \( -name .git -o -name node_modules \) -prune -o -name .env.local \( -type f -o -type l \) -print0)
fi

cd "$worktree_root"
bun install --frozen-lockfile
