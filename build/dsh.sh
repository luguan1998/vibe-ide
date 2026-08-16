#!/usr/bin/env bash
# dsh 封装：用安装目录内的 Vibe IDE.exe（ELECTRON_RUN_AS_NODE）启动 vendored dsh CLI
DIR="$(cd "$(dirname "$0")" && pwd)"
EXE="$DIR/Vibe IDE.exe"
BIN="$DIR/resources/app.asar/vendor/harness/apps/cli/lib/bin.js"
LOADER="$DIR/resources/dsh-loader-hook.mjs"

if [ ! -f "$EXE" ]; then
    echo "[ERROR] Vibe IDE.exe not found at $EXE" >&2
    exit 1
fi
if [ ! -f "$BIN" ]; then
    echo "[ERROR] dsh runtime not found at $BIN" >&2
    exit 1
fi

export ELECTRON_RUN_AS_NODE=1
LOADER_URL="file:///${LOADER//\\//}"
SPAWN_PATCH="$DIR/resources/dsh-spawn-patch.mjs"
SPAWN_URL="file:///${SPAWN_PATCH//\\//}"
"$EXE" --experimental-loader "$LOADER_URL" --import "$SPAWN_URL" "$BIN" "$@"
exit $?
