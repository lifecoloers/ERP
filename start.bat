@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Alwan Al-Hayat System

if not exist "server.js" goto :nozip
if not exist "public\index.html" goto :nozip

set "NODE=node"
where node >nul 2>nul
if not errorlevel 1 goto :found
set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE%" goto :found
set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if exist "%NODE%" goto :found
set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%NODE%" goto :found
if defined NVM_SYMLINK set "NODE=%NVM_SYMLINK%\node.exe"
if exist "%NODE%" goto :found
goto :nonode

:found
echo ==================================================
echo    Alwan Al-Hayat system is starting...
echo    Keep this window OPEN while using the system.
echo    Open in browser:  http://localhost:3000
echo ==================================================
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
"%NODE%" server.js
echo.
echo ==================================================
echo  The system stopped. If you see an error above,
echo  take a screenshot of this window and send it.
echo ==================================================
pause
exit /b

:nozip
echo ==================================================
echo  ERROR: The zip file is not extracted.
echo  Right-click the zip file - Extract All - Extract,
echo  then open the new folder and run start.bat again.
echo ==================================================
pause
exit /b

:nonode
echo ==================================================
echo  ERROR: Node.js was not found on this computer.
echo  - If you just installed it: RESTART the computer,
echo    then run start.bat again.
echo  - If not installed: download the LTS version from
echo    https://nodejs.org and install it (Next, Next...).
echo ==================================================
start "" https://nodejs.org
pause
exit /b
