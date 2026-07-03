#!/bin/bash

APP_NAME="vibe-ide"
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

echo "$APP_NAME v$VERSION"

build() {
  echo "Building..."
  npm run build
}

dev() {
  echo "Starting dev..."
  npm run dev
}

test_all() {
  echo "Running tests..."
  npm test
}

case "$1" in
  build) build ;;
  dev)   dev ;;
  test)  test_all ;;
  *)     echo "Usage: $0 {build|dev|test}" ;;
esac
