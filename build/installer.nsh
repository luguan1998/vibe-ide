!include "nsDialogs.nsh"

LangString VibeOptLabel 1033 "Choose additional options for Vibe IDE:"
LangString VibeOptLabel 2052 "选择 Vibe IDE 的附加选项:"
LangString VibeDesktopShortcut 1033 "Create desktop shortcut"
LangString VibeDesktopShortcut 2052 "创建桌面快捷方式"
LangString VibeCtxMenu 1033 "Add $\"Open with Vibe IDE$\" to file and folder right-click menu"
LangString VibeCtxMenu 2052 "将$\"用 Vibe IDE 打开$\"添加到文件和文件夹右键菜单"

!ifndef BUILD_UNINSTALLER
  Var CtxMenuState
  Var DesktopShortcutState

  !macro customInit
    StrCpy $CtxMenuState 1
    StrCpy $DesktopShortcutState 1
  !macroend

  !macro customPageAfterChangeDir
    Page custom fnCtxMenuCreate fnCtxMenuLeave
  !macroend

  Function fnCtxMenuCreate
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0 0 100% 24u "$(VibeOptLabel)"
    Pop $0

    ${NSD_CreateCheckbox} 0 28u 100% 12u "$(VibeDesktopShortcut)"
    Pop $DesktopShortcutState
    ${NSD_Check} $DesktopShortcutState

    ${NSD_CreateCheckbox} 0 44u 100% 12u "$(VibeCtxMenu)"
    Pop $CtxMenuState
    ${NSD_Check} $CtxMenuState

    nsDialogs::Show
  FunctionEnd

  Function fnCtxMenuLeave
    ${NSD_GetState} $DesktopShortcutState $DesktopShortcutState
    ${NSD_GetState} $CtxMenuState $CtxMenuState
  FunctionEnd

  !macro customInstall
    ${If} $DesktopShortcutState == 0
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}

    ${If} $CtxMenuState == 1
      WriteRegStr HKCU "Software\Classes\*\shell\VibeIDE" "" "Open with Vibe IDE"
      WriteRegStr HKCU "Software\Classes\*\shell\VibeIDE" "Icon" "$INSTDIR\Vibe IDE.exe"
      WriteRegStr HKCU "Software\Classes\*\shell\VibeIDE\command" "" '"$INSTDIR\Vibe IDE.exe" "%1"'

      WriteRegStr HKCU "Software\Classes\directory\shell\VibeIDE" "" "Open with Vibe IDE"
      WriteRegStr HKCU "Software\Classes\directory\shell\VibeIDE" "Icon" "$INSTDIR\Vibe IDE.exe"
      WriteRegStr HKCU "Software\Classes\directory\shell\VibeIDE\command" "" '"$INSTDIR\Vibe IDE.exe" "%1"'

      WriteRegStr HKCU "Software\Classes\Directory\Background\shell\VibeIDE" "" "Open with Vibe IDE"
      WriteRegStr HKCU "Software\Classes\Directory\Background\shell\VibeIDE" "Icon" "$INSTDIR\Vibe IDE.exe"
      WriteRegStr HKCU "Software\Classes\Directory\Background\shell\VibeIDE\command" "" '"$INSTDIR\Vibe IDE.exe" "%V"'
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\VibeIDE"
  DeleteRegKey HKCU "Software\Classes\directory\shell\VibeIDE"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\VibeIDE"
!macroend
