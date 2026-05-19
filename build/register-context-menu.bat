@echo off
setlocal enabledelayedexpansion

:: Get the directory where this script is located (same as exe)
set "EXE_DIR=%~dp0"
set "EXE_PATH=%EXE_DIR%Vibe IDE.exe"

if not exist "%EXE_PATH%" (
    echo [ERROR] Vibe IDE.exe not found at: %EXE_PATH%
    echo Please place this script in the same directory as Vibe IDE.exe
    pause
    exit /b 1
)

echo Registering Vibe IDE context menu...

:: Context menu for all files (*)
reg add "HKCU\Software\Classes\*\shell\VibeIDE" /ve /d "Open with Vibe IDE" /f >nul 2>&1
reg add "HKCU\Software\Classes\*\shell\VibeIDE" /v "Icon" /d "%EXE_PATH%" /f >nul 2>&1
reg add "HKCU\Software\Classes\*\shell\VibeIDE\command" /ve /d "\"%EXE_PATH%\" \"%%1\"" /f >nul 2>&1

:: Context menu for directories
reg add "HKCU\Software\Classes\directory\shell\VibeIDE" /ve /d "Open with Vibe IDE" /f >nul 2>&1
reg add "HKCU\Software\Classes\directory\shell\VibeIDE" /v "Icon" /d "%EXE_PATH%" /f >nul 2>&1
reg add "HKCU\Software\Classes\directory\shell\VibeIDE\command" /ve /d "\"%EXE_PATH%\" \"%%1\"" /f >nul 2>&1

:: Context menu for directory background (right-click empty space in folder)
reg add "HKCU\Software\Classes\Directory\Background\shell\VibeIDE" /ve /d "Open with Vibe IDE" /f >nul 2>&1
reg add "HKCU\Software\Classes\Directory\Background\shell\VibeIDE" /v "Icon" /d "%EXE_PATH%" /f >nul 2>&1
reg add "HKCU\Software\Classes\Directory\Background\shell\VibeIDE\command" /ve /d "\"%EXE_PATH%\" \"%%V\"" /f >nul 2>&1

echo Done. Right-click any file or folder to "Open with Vibe IDE".
pause
