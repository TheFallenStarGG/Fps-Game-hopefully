#!/usr/bin/env bash
# Downloads three into ./vendor/three (CI only — not committed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${THREE_VERSION:-0.170.0}"
DEST="$ROOT/vendor/three"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

cd "$TMP"
echo "Fetching three@$VER …"
npm pack "three@$VER"
tar -xzf three-*.tgz

# Support either classic layout (build/ + examples/jsm/) or nested
if [ ! -d package/build ]; then
  echo "Unexpected three package layout:"
  find package -maxdepth 3 -type d | head -40
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/build" "$DEST/examples"

cp -a package/build/. "$DEST/build/"

if [ -d package/examples/jsm ]; then
  mkdir -p "$DEST/examples/jsm"
  cp -a package/examples/jsm/. "$DEST/examples/jsm/"
elif [ -d package/examples ]; then
  cp -a package/examples/. "$DEST/examples/"
else
  echo "No examples/jsm in three package"
  find package -maxdepth 3 -type d | head -40
  exit 1
fi

printf '%s\n' "{\"name\":\"three\",\"version\":\"$VER\"}" > "$DEST/package.json"

# Sanity checks the game needs
test -f "$DEST/build/three.module.js"
test -f "$DEST/examples/jsm/loaders/GLTFLoader.js" || test -f "$DEST/examples/jsm/loaders/GLTFLoader.js"

echo "Vendored three@$VER → $DEST"
du -sh "$DEST" || true
find "$DEST/build" -name 'three.module.js'
find "$DEST/examples" -name 'GLTFLoader.js' | head -3
