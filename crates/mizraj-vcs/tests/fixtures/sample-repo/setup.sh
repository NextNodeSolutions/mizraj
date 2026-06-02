#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <target_dir>" >&2
  exit 1
fi

TARGET="$1"
REPO="$TARGET/repo"
WT="$TARGET/worktrees/locked"

mkdir -p "$REPO"
cd "$REPO"

git init -b main -q .
git config user.email "fixture@example.com"
git config user.name "Fixture"
git config commit.gpgsign false

echo "v1" > a.txt
git add a.txt
git commit -q -m "main: init"
SESSION_OID=$(git rev-parse HEAD)

git update-ref refs/mizraj/sessions/sample "$SESSION_OID"

echo "v2" > a.txt
git add a.txt
git commit -q -m "main: bump a.txt"

git checkout -q -b feature
echo "feature" > b.txt
git add b.txt
git commit -q -m "feature: add b.txt"

git checkout -q main

mkdir -p "$(dirname "$WT")"
git worktree add -q -b locked "$WT"
git worktree lock --reason "fixture lock" "$WT"

echo "v2-dirty" > a.txt
echo "untracked" > c.txt
