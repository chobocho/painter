#!/usr/bin/env bash
# Build script for the Painter TS rewrite.
# 1. Compile TypeScript
# 2. Run the test suite (must pass)
# 3. Bundle JS + inline CSS into a single release/index.html

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 빌드 도구는 package.json 에 고정된 로컬 설치본을 먼저 쓴다. 전역 tsc 나
# 네트워크의 npx 에 기대면 기계마다 다른 버전으로 빌드된다 (`npm ci` 권장).
TSC="$ROOT/node_modules/.bin/tsc"
[ -x "$TSC" ] || TSC="tsc"
ESBUILD="$ROOT/node_modules/.bin/esbuild"
[ -x "$ESBUILD" ] || ESBUILD="npx --yes esbuild"

echo "==> Cleaning previous outputs"
rm -rf dist release

echo "==> Compiling TypeScript ($TSC)"
"$TSC" -p tsconfig.json

echo "==> Running tests"
node dist/src/test/main.js

echo "==> Bundling JS"
mkdir -p release
BUNDLE="$(mktemp)"
trap 'rm -f "$BUNDLE"' EXIT
$ESBUILD dist/src/app/main.js \
  --bundle --format=iife --target=es2020 --platform=browser \
  --log-level=warning \
  > "$BUNDLE"

echo "==> Inlining into release/index.html"
HTML="src/index.html" CSS="src/style.css" JS="$BUNDLE" OUT="release/index.html" node -e '
const fs = require("fs");
const html = fs.readFileSync(process.env.HTML, "utf8");
const css  = fs.readFileSync(process.env.CSS,  "utf8");
const js   = fs.readFileSync(process.env.JS,   "utf8");
const out = html
  .replace(/\s*<link\s+rel="stylesheet"[^>]*>\s*/i,
           "\n    <style>\n" + css + "\n    </style>\n  ")
  .replace(/\s*<script\b[^>]*><\/script>\s*/i,
           "\n    <script>\n" + js + "\n    </script>\n  ");
fs.writeFileSync(process.env.OUT, out);
'

SIZE=$(du -sh release/index.html | cut -f1)
echo "==> BUILD OK ($SIZE)"
