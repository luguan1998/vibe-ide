@echo off

echo Removing Vibe IDE context menu...

reg delete "HKCU\Software\Classes\*\shell\VibeIDE" /f >nul 2>&1
reg delete "HKCU\Software\Classes\directory\shell\VibeIDE" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Directory\Background\shell\VibeIDE" /f >nul 2>&1

:: Remove this directory from user PATH (dsh command cleanup)
set "EXE_DIR=%~dp0"
for %%I in ("%EXE_DIR%.") do set "CLEAN_DIR=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%CLEAN_DIR%'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if ($p) { $n=(($p -split ';') | Where-Object { $_ -ne $d }) -join ';'; if ($n -ne $p) { [Environment]::SetEnvironmentVariable('Path',$n,'User'); Write-Host 'Removed from user PATH: %CLEAN_DIR%' } else { Write-Host 'Not in user PATH: %CLEAN_DIR%' } } else { Write-Host 'No user PATH' }"

echo Done. Vibe IDE context menu removed.
pause
