#!/usr/bin/env bash
set -euo pipefail
sdk_source=${1:?Pass the installed VEX V5 C++ SDK directory containing vexv5/}
test -f "$sdk_source/vexv5/lscript.ld"
cd "$(dirname "$0")"
mkdir -p vendor/sdk
cp -a "$sdk_source/." vendor/sdk/
