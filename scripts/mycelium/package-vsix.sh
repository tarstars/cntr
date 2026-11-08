#!/usr/bin/env bash
# Build Mycelium from source and package it as a .vsix in the large-artifact directory
# (never in git). Prints the path of the written .vsix on stdout.
set -euo pipefail
cd "$(dirname "$0")/../.."
out_dir="${MYCELIUM_BUILD_DIR:-$HOME/database/20261108_mycelium/builds}"
mkdir -p "$out_dir"
version=$(node -p "require('./package.json').version")
sha=$(git rev-parse --short HEAD)
out="$out_dir/mycelium-$version-$sha.vsix"
npm run package >&2
npx vsce package --no-dependencies --allow-package-secrets sendgrid -o "$out" >&2
echo "$out"
