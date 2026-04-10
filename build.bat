@echo off
setlocal enabledelayedexpansion

set ROOT=%~dp0
cd /d "%ROOT%"

echo ==> Cleaning previous outputs
if exist dist rd /s /q dist
if exist release rd /s /q release

echo ==> Compiling TypeScript
call tsc
if errorlevel 1 (
    echo [ERROR] TypeScript compilation failed.
    exit /b %errorlevel%
)

echo ==> Running tests
node dist\src\test\main.js
if errorlevel 1 (
    echo [ERROR] Tests failed.
    exit /b %errorlevel%
)

echo ==> Staging release/
if not exist release\js mkdir release\js
if not exist release\img mkdir release\img

:: Copy entry HTML and CSS to the release root.
if exist src\index.html copy src\index.html release\index.html >nul
if exist src\style.css  copy src\style.css  release\style.css  >nul

:: Copy image assets (legacy palette icons re-used by the new UI).
if exist legacy\img (
    xcopy /e /i /y legacy\img release\img >nul
)

:: Copy compiled JS, mirroring the src tree under release/js, but exclude tests.
:: Using robocopy to mirror structure and exclude test folder.
:: /S: copy subdirectories, but not empty ones
:: /XD: exclude directories matching given names/paths
robocopy dist\src release\js *.js /S /XD test >nul
echo ==> BUILD OK (Release directory staged, Total Size: !size! Bytes)


