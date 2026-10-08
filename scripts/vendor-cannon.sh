#!/bin/sh
# Rebuilds vendor/cannon-es.js: just the parts of cannon-es the tray uses, minified.
# The app itself has no build step; this only runs when bumping the library.
set -eu
VERSION=0.20.0
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm pack -q "cannon-es@$VERSION" >/dev/null && tar xzf "cannon-es-$VERSION.tgz")
cat > "$tmp/entry.js" <<JS
export { World, Body, ConvexPolyhedron, Plane, Vec3, Quaternion, Material, ContactMaterial, SAPBroadphase }
  from './package/dist/cannon-es.js';
JS
{
  printf '/* cannon-es %s (https://github.com/pmndrs/cannon-es), MIT licence, Copyright (c) 2015 cannon.js Authors.\n   Tree-shaken and minified by scripts/vendor-cannon.sh; do not edit by hand. */\n' "$VERSION"
  npx -y esbuild@0.25 "$tmp/entry.js" --bundle --minify --format=esm --log-level=warning
} > vendor/cannon-es.js
