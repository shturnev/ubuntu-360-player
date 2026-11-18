; "Open with" entries only. The default application for each type is never changed.
!macro registerOpenWith EXT
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}" ""
!macroend

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  !insertmacro registerOpenWith ".jpg"
  !insertmacro registerOpenWith ".jpeg"
  !insertmacro registerOpenWith ".png"
  !insertmacro registerOpenWith ".mp4"
  !insertmacro registerOpenWith ".insp"
  !insertmacro registerOpenWith ".insv"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!macroend
