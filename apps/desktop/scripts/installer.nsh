; Custom installer steps for the FaberLoom desktop build.
;
; `customInstall` restores the error flag around the plugin-directory cleanup
; NSIS performs while the Finish page may already have launched the application.
;
; The assisted installer shows no uninstall confirmation of its own (only the
; one-click flow does, and this product ships the assisted one), so
; `customUnInit` asks before the uninstall starts and `customUnInstall` asks
; whether the user data should go with it. Declining the first dialog quits the
; uninstaller; the second defaults to keeping the data, and both stay silent
; during the silent uninstall an update performs.
!include "LogicLib.nsh"

; Whether the user asked for the Harness home and the application profile to be
; deleted; `customUnInit` sets it and `customUnInstall` reads it.
Var /GLOBAL faberloomDeleteUserData

; The data-question text, assembled once per uninstall so the two paths it names
; expand from the installer's own variables.
Var /GLOBAL faberloomUninstallPrompt

LangString faberloomUninstallData 1033 "Delete your FaberLoom data as well?"
LangString faberloomUninstallData 3082 "¿Borrar también tus datos de FaberLoom?"
LangString faberloomUninstallData 2052 "是否同时删除您的 FaberLoom 数据？"

!macro customInstall
  Push $0
  StrCpy $0 0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  ; Finish can launch the app while NSIS removes its remaining plugin directory.
  RMDir /r "$PLUGINSDIR\7z-out"
  ${If} $0 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $0
!macroend

!macro customUnInit
  StrCpy $faberloomDeleteUserData "0"
  ${IfNot} ${Silent}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(areYouSureToUninstall)" IDOK faberloomUninstallConfirmed
    Quit

    faberloomUninstallConfirmed:
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${Silent}
    StrCpy $faberloomUninstallPrompt "$(faberloomUninstallData)$\r$\n$\r$\n"
    StrCpy $faberloomUninstallPrompt "$faberloomUninstallPrompt$PROFILE\.dsh$\r$\n"
    StrCpy $faberloomUninstallPrompt "$faberloomUninstallPrompt$APPDATA\@deepseek-ai\dsh-desktop"
    MessageBox MB_YESNO|MB_ICONQUESTION "$faberloomUninstallPrompt" /SD IDNO IDYES faberloomDeleteData
    Goto faberloomDataChosen

    faberloomDeleteData:
      StrCpy $faberloomDeleteUserData "1"

    faberloomDataChosen:
  ${EndIf}

  ${If} $faberloomDeleteUserData == "1"
    ; Electron always uses per-user application data, and the default Harness
    ; home holds the sessions, Spaces and settings a user may want to keep.
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}
    !insertmacro faberloomRemoveUserData "$APPDATA" "$LOCALAPPDATA" "$PROFILE"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend

; Remove the per-user state a full uninstall owns under one roaming-data root,
; one local-data root, and one user profile directory. The roots stay parameters
; so the Windows qualification smoke can drive the same list over a scratch tree
; instead of the running user's data.
!macro faberloomRemoveUserData APP_DATA LOCAL_APP_DATA PROFILE_DIR
  RMDir /r "${APP_DATA}\${APP_FILENAME}"
  !ifdef APP_PRODUCT_FILENAME
    RMDir /r "${APP_DATA}\${APP_PRODUCT_FILENAME}"
  !endif
  !ifdef APP_PACKAGE_NAME
    RMDir /r "${APP_DATA}\${APP_PACKAGE_NAME}"
  !endif
  RMDir /r "${APP_DATA}\@deepseek-ai"
  RMDir /r "${LOCAL_APP_DATA}\@deepseek-aidsh-desktop-updater"
  RMDir /r "${LOCAL_APP_DATA}\faberloom-updater"
  RMDir /r "${PROFILE_DIR}\.dsh"
!macroend
