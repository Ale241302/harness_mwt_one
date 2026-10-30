; Compile with OUTPUT_FILE, RESULT_FILE, APP_DATA_DIR, LOCAL_APP_DATA_DIR and
; PROFILE_DIR in a private test directory, then run silently. The fixture drives
; the real uninstall data list over a scratch tree: the silent uninstall must
; keep every sentinel, and the explicit removal must take exactly the owned
; directories while leaving their siblings alone.
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Desktop uninstall data smoke"
OutFile "${OUTPUT_FILE}"
!define APP_FILENAME "Faberloom"
!define APP_PRODUCT_FILENAME "faberloom-desktop"
!define APP_PACKAGE_NAME "dsh-desktop"
!define PRODUCT_NAME "Faberloom"
Var installMode
!include "..\..\scripts\installer.nsh"

!macro makeDir PATH
  CreateDirectory "${PATH}"
  FileOpen $1 "${PATH}\sentinel" w
  FileWrite $1 "keep"
  FileClose $1
!macroend

Section
  StrCpy $installMode "current"

  !insertmacro makeDir "${APP_DATA_DIR}\Faberloom"
  !insertmacro makeDir "${APP_DATA_DIR}\faberloom-desktop"
  !insertmacro makeDir "${APP_DATA_DIR}\dsh-desktop"
  !insertmacro makeDir "${APP_DATA_DIR}\@deepseek-ai\dsh-desktop"
  !insertmacro makeDir "${LOCAL_APP_DATA_DIR}\@deepseek-aidsh-desktop-updater"
  !insertmacro makeDir "${LOCAL_APP_DATA_DIR}\faberloom-updater"
  !insertmacro makeDir "${PROFILE_DIR}\.dsh\sessions"
  ; Siblings the uninstall must not touch.
  !insertmacro makeDir "${APP_DATA_DIR}\keep-me"
  !insertmacro makeDir "${LOCAL_APP_DATA_DIR}\keep-me"
  FileOpen $1 "${PROFILE_DIR}\keep.txt" w
  FileWrite $1 "keep"
  FileClose $1

  ; A silent uninstall (an update) never asks and therefore keeps the data.
  !insertmacro customUnInit
  StrCmp $faberloomDeleteUserData "0" 0 failed
  !insertmacro customUnInstall
  IfFileExists "${APP_DATA_DIR}\@deepseek-ai\dsh-desktop\*.*" 0 failed
  IfFileExists "${PROFILE_DIR}\.dsh\sessions\*.*" 0 failed

  ; The chosen removal takes exactly the owned directories.
  !insertmacro faberloomRemoveUserData "${APP_DATA_DIR}" "${LOCAL_APP_DATA_DIR}" "${PROFILE_DIR}"
  IfFileExists "${APP_DATA_DIR}\Faberloom\*.*" failed
  IfFileExists "${APP_DATA_DIR}\faberloom-desktop\*.*" failed
  IfFileExists "${APP_DATA_DIR}\dsh-desktop\*.*" failed
  IfFileExists "${APP_DATA_DIR}\@deepseek-ai\*.*" failed
  IfFileExists "${LOCAL_APP_DATA_DIR}\@deepseek-aidsh-desktop-updater\*.*" failed
  IfFileExists "${LOCAL_APP_DATA_DIR}\faberloom-updater\*.*" failed
  IfFileExists "${PROFILE_DIR}\.dsh\*.*" failed
  IfFileExists "${APP_DATA_DIR}\keep-me\*.*" 0 failed
  IfFileExists "${LOCAL_APP_DATA_DIR}\keep-me\*.*" 0 failed
  IfFileExists "${PROFILE_DIR}\keep.txt" 0 failed

  FileOpen $1 "${RESULT_FILE}" w
  FileWrite $1 "silent uninstall kept the data; the chosen removal took exactly the owned directories"
  FileClose $1
  SetErrorLevel 0
  Quit

  failed:
  FileOpen $1 "${RESULT_FILE}" w
  FileWrite $1 "uninstall data smoke failed"
  FileClose $1
  SetErrorLevel 1
  Quit
SectionEnd
