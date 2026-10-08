#!/bin/sh
# Rebuilds vendor/: just the parts of three.js and cannon-es the tray uses, minified.
# The app itself has no build step; this only runs when bumping a library.
set -eu
THREE=0.186.1
CANNON=0.20.0
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && npm pack -q "three@$THREE" "cannon-es@$CANNON" >/dev/null \
  && mkdir three cannon && tar xzf "three-$THREE.tgz" -C three && tar xzf "cannon-es-$CANNON.tgz" -C cannon)

# $1 name, $2 version, $3 licence line, $4 entry module
bundle() {
  printf '%s\n' "$4" > "$tmp/$1-entry.js"
  {
    printf '/* %s %s, %s\n   Tree-shaken and minified by scripts/vendor.sh; do not edit by hand. */\n' "$1" "$2" "$3"
    npx -y esbuild@0.25 "$tmp/$1-entry.js" --bundle --minify --format=esm --log-level=warning
  } > "vendor/$1.js"
}

bundle three "$THREE" '(https://threejs.org), MIT licence, Copyright 2010-2026 three.js authors' \
  "export { WebGLRenderer, Scene, OrthographicCamera, Mesh, BufferGeometry, Float32BufferAttribute,
    MeshLambertMaterial, ShadowMaterial, PlaneGeometry, DirectionalLight, AmbientLight, CanvasTexture,
    Vector3, Quaternion, Matrix4, Box3, PCFSoftShadowMap, SRGBColorSpace } from './three/package/build/three.module.js';"

bundle cannon-es "$CANNON" '(https://github.com/pmndrs/cannon-es), MIT licence, Copyright (c) 2015 cannon.js Authors' \
  "export { World, Body, ConvexPolyhedron, Plane, Vec3, Quaternion, Material, ContactMaterial, SAPBroadphase }
    from './cannon/package/dist/cannon-es.js';"
