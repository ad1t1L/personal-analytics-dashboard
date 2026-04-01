#!/usr/bin/env bash
# Cross-compile the dashboard launcher. Requires Go 1.21+.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
echo "Building into launcher/dist/ ..."
GOOS=windows   GOARCH=amd64 go build -ldflags="-s -w" -o dist/dashboard-launcher-windows-amd64.exe .
GOOS=linux     GOARCH=amd64 go build -ldflags="-s -w" -o dist/dashboard-launcher-linux-amd64 .
GOOS=darwin    GOARCH=amd64 go build -ldflags="-s -w" -o dist/dashboard-launcher-macos-amd64 .
GOOS=darwin    GOARCH=arm64 go build -ldflags="-s -w" -o dist/dashboard-launcher-macos-arm64 .
echo "Done:"
ls -la dist/
