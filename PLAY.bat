@echo off
REM ---------------------------------------------------------------------------
REM  LUMEN - start here.
REM
REM  Opening index.html directly gives the page a file:// origin, and Chrome
REM  cannot remember ANY permission for that origin. That is why the microphone
REM  prompt kept coming back however many times you allowed it: each request was,
REM  as far as the browser was concerned, from a brand new stranger.
REM
REM  This serves the game from http://localhost instead, which is a real origin.
REM  Allow the microphone once there and it stays allowed.
REM
REM  It prefers tools\serve.js because that sends "Cache-Control: no-store".
REM  Python's http.server sends no cache headers at all, which lets Chrome hold
REM  on to index.html by its own guesswork - and a stale index.html means stale
REM  ?v= script URLs, so you keep playing a build from an hour ago and wonder
REM  why a fix did not arrive.
REM ---------------------------------------------------------------------------
setlocal
set PORT=5178
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  echo Serving LUMEN on http://localhost:%PORT%  (no-store)
  start "" http://localhost:%PORT%/index.html
  node tools\serve.js %PORT%
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Serving LUMEN on http://localhost:%PORT%
  echo WARNING: python's server sends no cache headers. If a change does not
  echo          show up, reload with Ctrl+Shift+R.
  start "" http://localhost:%PORT%/index.html
  python -m http.server %PORT%
  goto :eof
)

echo.
echo Could not find Node or Python on this machine.
echo Install either one, or open index.html directly - the game still runs,
echo but the browser will keep re-asking for the microphone.
echo.
pause
