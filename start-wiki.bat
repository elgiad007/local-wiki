@echo off
setlocal
cd /d "%~dp0"
set "wikiRuntime=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 if exist "%wikiRuntime%\node\bin\node.exe" set "PATH=%wikiRuntime%\node\bin;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then try again.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Update Node.js, then try again.
  pause
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 if exist "%APPDATA%\npm\pnpm.cmd" set "PATH=%APPDATA%\npm;%PATH%"
where pnpm >nul 2>nul
if errorlevel 1 if exist "%LOCALAPPDATA%\pnpm\pnpm.exe" set "PATH=%LOCALAPPDATA%\pnpm;%PATH%"
where pnpm >nul 2>nul
if errorlevel 1 if exist "%wikiRuntime%\bin\fallback\pnpm.cmd" set "PATH=%wikiRuntime%\bin\fallback;%PATH%"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo Install pnpm, then try again.
  pause
  exit /b 1
)
if not exist "node_modules\.modules.yaml" (
  call pnpm install --frozen-lockfile
  if errorlevel 1 goto failed
)
echo Building the latest wiki...
call pnpm build
if errorlevel 1 goto failed
if /i "%~1"=="--build-only" exit /b 0
echo Starting http://127.0.0.1:4173/
echo Keep this window open. Press Ctrl+C to stop the server.
echo To refresh older cached styles, use Wiki ^& backups - Clear app cache.
call pnpm preview --port 4173 --strictPort --open
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo The wiki could not start. Review the error above.
echo If port 4173 is in use, close the existing server and try again.
pause
exit /b 1
