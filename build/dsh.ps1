# dsh 封装：用安装目录内的 Vibe IDE.exe（ELECTRON_RUN_AS_NODE）启动 vendored dsh CLI
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'Vibe IDE.exe'
$bin = Join-Path $PSScriptRoot 'resources\app.asar\vendor\harness\apps\cli\lib\bin.js'
$loader = Join-Path $PSScriptRoot 'resources\dsh-loader-hook.mjs'

if (-not (Test-Path $exe)) {
    Write-Error "Vibe IDE.exe not found at $exe"
    exit 1
}
if (-not (Test-Path $bin)) {
    Write-Error "dsh runtime not found at $bin"
    exit 1
}

$env:ELECTRON_RUN_AS_NODE = '1'
$loaderUrl = 'file:///' + ($loader -replace '\\', '/')
$spawnPatch = Join-Path $PSScriptRoot 'resources\dsh-spawn-patch.mjs'
$spawnUrl = 'file:///' + ($spawnPatch -replace '\\', '/')
& $exe --experimental-loader $loaderUrl --import $spawnUrl $bin @args
exit $LASTEXITCODE
