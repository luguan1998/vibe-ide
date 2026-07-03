#!/bin/sh

APP_NAME="vibe-ide"
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

echo "$APP_NAME v$VERSION"

case "$1" in
  build) npm run build ;;
  dev)   npm run dev ;;
  test)  npm test ;;
  *)     echo "Usage: $0 {build|dev|test}" ;;
esac
