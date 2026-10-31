@echo off
REM One-click installer for dsh-soul-presets (Windows).
REM
REM Double-click for the default profile, or pass options through:
REM   install.cmd --profile desktop --skip-plugin-install
REM   install.cmd --check
REM   install.cmd --home L:\dsh\.dsh-home
REM
REM The script must run under the same Node that runs dsh (>= 22.19). When the
REM `node` on PATH is older, point DSH_NODE at the right binary first:
REM   set DSH_NODE=D:\softwares\node-v24.21.0-win-x64\node.exe
setlocal
set "SCRIPT=%~dp0scripts\install.mjs"

if defined DSH_NODE (
  "%DSH_NODE%" "%SCRIPT%" %*
) else (
  node "%SCRIPT%" %*
)
set "CODE=%ERRORLEVEL%"

REM A bare invocation is usually a double-click: keep the window open so the
REM restart and verification instructions stay readable.
if "%~1"=="" pause
exit /b %CODE%
