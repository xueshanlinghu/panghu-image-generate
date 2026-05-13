@echo off
setlocal

cd /d "%~dp0"

echo.
echo [Panghu] Checking default ports...

for %%P in (5173 8787) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
    if not "%%A"=="0" (
      echo [Panghu] Port %%P is in use by PID %%A. Stopping it...
      taskkill /PID %%A /F >nul 2>nul
    )
  )
)

echo [Panghu] Starting dev services...
echo [Panghu] Frontend: http://localhost:5173
echo [Panghu] Backend:  http://localhost:8787
echo.

npm run dev

echo.
echo [Panghu] Dev services stopped.
pause
