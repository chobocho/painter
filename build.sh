#!/usr/bin/env bash
# Build script for the Painter TS rewrite.
# 1. Compile TypeScript
# 2. Run the test suite (must pass)
# 3. Stage HTML, CSS, JS, and image assets into release/

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Cleaning previous outputs"
rm -rf dist release

echo "==> Compiling TypeScript"
tsc

echo "==> Running tests"
node dist/src/test/main.js

echo "==> Staging release/"
mkdir -p release/js release/img

# Copy entry HTML and CSS to the release root.
cp src/index.html release/index.html
cp src/style.css  release/style.css

# Copy image assets (legacy palette icons re-used by the new UI).
if [ -d legacy/img ]; then
  cp -r legacy/img/. release/img/
fi

# Copy compiled JS, mirroring the src tree under release/js, but exclude tests.
cd dist/src
find . -type f -name "*.js" -not -path "./test/*" | while read -r f; do
  dest="$ROOT/release/js/$(echo "$f" | sed 's|^\./||')"
  mkdir -p "$(dirname "$dest")"
  cp "$f" "$dest"
done
cd "$ROOT"

SIZE=$(du -sh release | cut -f1)
echo "==> BUILD OK ($SIZE)"
