#!/usr/bin/env bash
set -euo pipefail

# Deploy the static site to GitHub Pages.
#
# Target:
# - GitHub user: FilekBananas
# - Repo:        staszek
# - Pages:       gh-pages branch (root)

GITHUB_USER="${GITHUB_USER:-FilekBananas}"
REPO_NAME="${REPO_NAME:-staszek}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
# Default to HTTPS (classic). You can override via:
# - SSH:   REMOTE_URL=git@github.com:<user>/<repo>.git bash gh.sh
# - HTTPS: REMOTE_URL=https://github.com/<user>/<repo>.git bash gh.sh
REMOTE_URL="${REMOTE_URL:-https://github.com/${GITHUB_USER}/${REPO_NAME}.git}"
UPDATE_REMOTE_URL="${UPDATE_REMOTE_URL:-0}"
BRANCH_MAIN="${BRANCH_MAIN:-main}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
COMMIT_MSG="${COMMIT_MSG:-deploy}"
SOURCE_DIR="${SOURCE_DIR:-.}"
FORCE_MAIN_PUSH="${FORCE_MAIN_PUSH:-0}"
SKIP_MAIN_PUSH="${SKIP_MAIN_PUSH:-0}"
SSH_IDENTITY_FILE="${SSH_IDENTITY_FILE:-}"

if [[ -n "$SSH_IDENTITY_FILE" ]]; then
  if [[ ! -f "$SSH_IDENTITY_FILE" ]]; then
    echo "Error: SSH_IDENTITY_FILE does not exist: $SSH_IDENTITY_FILE"
    exit 1
  fi
  identity_escaped="$(printf "%q" "$SSH_IDENTITY_FILE")"
  export GIT_SSH_COMMAND="ssh -i $identity_escaped -o IdentitiesOnly=yes"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git not found."
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: missing source directory: '$SOURCE_DIR/'."
  exit 1
fi

if [[ ! -d .git ]]; then
  git init
  git checkout -b "$BRANCH_MAIN"
fi

# Generate static share pages (Open Graph previews).
if [[ -f "scripts/generate-share-pages.js" ]]; then
  if command -v node >/dev/null 2>&1; then
    node scripts/generate-share-pages.js
  else
    echo "Warning: node not found; skipping share page generation."
  fi
fi

current_remote_url="$(git remote get-url "$REMOTE_NAME" 2>/dev/null || true)"
if [[ -z "$current_remote_url" ]]; then
  git remote add "$REMOTE_NAME" "$REMOTE_URL"
elif [[ "$UPDATE_REMOTE_URL" == "1" && "$current_remote_url" != "$REMOTE_URL" ]]; then
  echo "Updating remote '$REMOTE_NAME':"
  echo "  from: $current_remote_url"
  echo "  to:   $REMOTE_URL"
  git remote set-url "$REMOTE_NAME" "$REMOTE_URL"
fi

# Commit current changes to main branch (optional but useful).
git add -A
if ! git diff --cached --quiet; then
  git commit -m "$COMMIT_MSG"
fi

git branch -M "$BRANCH_MAIN"
push_main() {
  if [[ "$FORCE_MAIN_PUSH" == "1" ]]; then
    git push -u -f "$REMOTE_NAME" "$BRANCH_MAIN"
  else
    git push -u "$REMOTE_NAME" "$BRANCH_MAIN"
  fi
}

if [[ "$SKIP_MAIN_PUSH" != "1" ]]; then
  push_log="$(mktemp -t staszek-push.XXXXXX 2>/dev/null || mktemp 2>/dev/null || true)"
  if [[ -n "${push_log:-}" ]]; then
    if push_main >"$push_log" 2>&1; then
      rm -f "$push_log" >/dev/null 2>&1 || true
    else
      # If this is a non-fast-forward / fetch-first, try rebase. Otherwise, exit with guidance.
      if grep -Eqi "(fetch first|non-fast-forward|rejected)" "$push_log" 2>/dev/null; then
        echo "Main push rejected. Trying to rebase onto remote '$REMOTE_NAME/$BRANCH_MAIN'…"
        git fetch "$REMOTE_NAME" "$BRANCH_MAIN" || true
        if git pull --rebase "$REMOTE_NAME" "$BRANCH_MAIN"; then
          push_main
        else
          cat <<EOF

Rebase failed (probably conflicts).

Options:
1) Resolve conflicts, then run: git rebase --continue
2) Abort rebase:            git rebase --abort
3) If you want to overwrite the remote main branch:
     FORCE_MAIN_PUSH=1 bash gh.sh
4) If you only want to publish GitHub Pages (skip main push):
     git rebase --abort
     SKIP_MAIN_PUSH=1 bash gh.sh

EOF
          exit 1
        fi
      else
        cat "$push_log" 2>/dev/null || true
        rm -f "$push_log" >/dev/null 2>&1 || true
        if grep -Eqi "denied to deploy key" "$push_log" 2>/dev/null; then
          cat <<EOF

SSH auth is using a deploy key that doesn't have access to this repo.

Fix options:
1) Use your personal SSH key for this push:
     SSH_IDENTITY_FILE=~/.ssh/id_ed25519 bash gh.sh
   (and make sure that public key is added in GitHub → Settings → SSH keys)
2) Or add the deploy key to this repo with write access:
   GitHub → Repo Settings → Deploy keys → Add key → Allow write access

Tip: check which key is used with:
     ssh -T git@github.com

EOF
          exit 1
        fi
        cat <<EOF

Push failed (not a rebase issue). Common causes:
- Internet/DNS problems
- GitHub auth/token issues (HTTPS)

Try:
1) Retry in a minute
2) Use SSH remote:
     REMOTE_URL=git@github.com:${GITHUB_USER}/${REPO_NAME}.git bash gh.sh
3) Force HTTP/1.1 (helps some HTTP 400 issues):
     git config --global http.version HTTP/1.1

EOF
        exit 1
      fi
      rm -f "$push_log" >/dev/null 2>&1 || true
    fi
  else
    if ! push_main; then
      echo "Push failed. Try SSH: REMOTE_URL=git@github.com:${GITHUB_USER}/${REPO_NAME}.git bash gh.sh"
      exit 1
    fi
  fi
fi

if ! git rev-parse --verify "$BRANCH_MAIN" >/dev/null 2>&1; then
  cat <<EOF

Push failed.

Common fixes:
1) Make sure the repo exists: https://github.com/${GITHUB_USER}/${REPO_NAME}
2) If using HTTPS, authenticate with a GitHub token (not your password).
3) If you prefer SSH, run:
     REMOTE_URL=git@github.com:${GITHUB_USER}/${REPO_NAME}.git bash gh.sh
   and add your SSH key to GitHub: Settings → SSH and GPG keys.

EOF
  exit 1
fi

# Deploy the site to the Pages branch.
#
# NOTE: this FORCE UPDATES the gh-pages branch.
#
# Implementation uses a temporary git worktree so we don't trash your working tree.
tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t staszek-pages)"
cleanup() {
  set +e
  git worktree remove --force "$tmp_dir" >/dev/null 2>&1 || true
  rm -rf "$tmp_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git worktree add -B "$PAGES_BRANCH" "$tmp_dir" "$BRANCH_MAIN" >/dev/null

# Clear worktree contents (keep .git file/dir used by worktree).
find "$tmp_dir" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} + >/dev/null 2>&1 || true

# Copy site files from SOURCE_DIR into the worktree root.
# Exclude git internals and the deploy script itself.
rsync -a \
  --exclude ".git" \
  --exclude ".DS_Store" \
  --exclude "gh.sh" \
  --exclude ".pages-worktree" \
  --exclude ".pages-worktree/" \
  --exclude ".gitignore" \
  "$SOURCE_DIR"/ "$tmp_dir"/

git -C "$tmp_dir" add -A
if ! git -C "$tmp_dir" diff --cached --quiet; then
  git -C "$tmp_dir" commit -m "$COMMIT_MSG" >/dev/null
fi
git -C "$tmp_dir" push -f "$REMOTE_NAME" "$PAGES_BRANCH:$PAGES_BRANCH"

echo "Done."
echo "If needed, enable GitHub Pages: Settings → Pages → Deploy from branch → $PAGES_BRANCH / (root)."
