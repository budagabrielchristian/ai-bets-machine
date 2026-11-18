@echo off
title AI Bets Machine
cd /d "%~dp0"

if not exist node_modules call npm install

if exist data\users.json goto start
echo No account yet. Choose a username and password for the dashboard.
set /p ABM_USER=Username:
call npm run create-user -- %ABM_USER%
if errorlevel 1 goto failed

:start
echo.
echo Starting... the dashboard opens at http://localhost:8787
echo Keep this window open: the AIs only run while it is open. Close it to stop.
echo.
start "" cmd /c "timeout /t 8 >nul && start http://localhost:8787"
call npm run local
goto end

:failed
echo Account was not created. Run this file again.

:end
pause
