#!/usr/bin/env bash
# Rewrites index.html import map to use ./vendor/three (offline).
set -euo pipefail
FILE="${1:-index.html}"
test -f "$FILE"
# Portable sed
if sed --version >/dev/null 2>&1; then
  SED=(sed -i)
else
  SED=(sed -i '')
fi
"${SED[@]}" 's|https://unpkg.com/three@[^/]*/build/three.module.js|./vendor/three/build/three.module.js|g' "$FILE"
"${SED[@]}" 's|https://unpkg.com/three@[^/]*/examples/jsm/|./vendor/three/examples/jsm/|g' "$FILE"
echo "Patched import map in $FILE → local vendor"
grep -n "three" "$FILE" | head -10
