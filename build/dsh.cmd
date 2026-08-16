@echo off
setlocal
:: dsh 封装：用安装目录内的 Vibe IDE.exe（ELECTRON_RUN_AS_NODE）启动 vendored dsh CLI
set "EXE_DIR=%~dp0"
set "EXE_PATH=%EXE_DIR%Vibe IDE.exe"
set "BIN=%EXE_DIR%resources\app.asar\vendor\harness\apps\cli\lib\bin.js"
set "LOADER=%EXE_DIR%resources\dsh-loader-hook.mjs"

if not exist "%EXE_PATH%" (
    echo [ERROR] Vibe IDE.exe not found at "%EXE_PATH%"
    exit /b 1
)
if not exist "%BIN%" (
    echo [ERROR] dsh runtime not found at "%BIN%"
    exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
set "LOADER_URL=file:///%LOADER:\=/%"
"%EXE_PATH%" --experimental-loader "%LOADER_URL%" "%BIN%" %*
exit /b %errorlevel%
