#!/usr/bin/env bash
# Downloads three@0.170.0 into ./vendor/three (not committed — CI only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${THREE_VERSION:-0.170.0}"
DEST="$ROOT/vendor/three"
TMP="$(mktemp -d)"
cd "$TMP"
echo "Fetching three@$VER …"
npm pack "three@$VER" >/dev/null
tar -xzf three-*.tgz
rm -rf "$DEST"
mkdir -p "$DEST"
cp -a package/build "$DEST/build"
cp -a package/examples/jsm "$DEST/examples/jsm"
# Keep package.json bit for clarity
echo "{\"name\":\"three\",\"version\":\"$VER\"}" > "$DEST/package.json"
echo "Vendored three@$VER → $DEST"
du -sh "$DEST"
rm -rf "$TMP"
