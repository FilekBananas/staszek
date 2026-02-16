#!/usr/bin/env bash
set -euo pipefail

# Wrapper for deploying this static site.
# Uses the existing `gh.sh` script (GitHub Pages: gh-pages branch).

cd "$(dirname "$0")"

if [[ ! -f "gh.sh" ]]; then
  echo "Error: missing gh.sh in $(pwd)"
  exit 1
fi

bash gh.sh
