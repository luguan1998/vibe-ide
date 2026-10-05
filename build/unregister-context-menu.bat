@echo off

echo Removing Vibe IDE context menu...

reg delete "HKCU\Software\Classes\*\shell\VibeIDE" /f >nul 2>&1
reg delete "HKCU\Software\Classes\directory\shell\VibeIDE" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Directory\Background\shell\VibeIDE" /f >nul 2>&1

echo Done. Vibe IDE context menu removed.
pause
