@echo off
setlocal

set APP_NAME=vibe-ide
for /f "delims=" %%v in ('node -p "require(\"./package.json\").version" 2^>nul') do set VERSION=%%v
if "%VERSION%"=="" set VERSION=unknown

echo %APP_NAME% v%VERSION%

if "%1"=="build" (
  echo Building...
  call npm run build
) else if "%1"=="dev" (
  echo Starting dev...
  call npm run dev
) else if "%1"=="test" (
  echo Running tests...
  call npm test
) else (
  echo Usage: %~nx0 {build^|dev^|test}
)

endlocal
