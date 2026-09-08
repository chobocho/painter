@echo off
setlocal

set ROOT=%~dp0
cd /d "%ROOT%"

:: 빌드 도구는 package.json 에 고정된 로컬 설치본을 먼저 쓴다 (npm ci 권장).
set TSC=%ROOT%node_modules\.bin\tsc.cmd
if not exist "%TSC%" set TSC=tsc
set ESBUILD=%ROOT%node_modules\.bin\esbuild.cmd
if not exist "%ESBUILD%" set ESBUILD=npx --yes esbuild

echo ==^> Cleaning previous outputs
if exist dist rd /s /q dist
if exist release rd /s /q release

echo ==^> Compiling TypeScript
call "%TSC%" -p tsconfig.json
if errorlevel 1 (
    echo [ERROR] TypeScript compilation failed.
    exit /b 1
)

echo ==^> Running tests
node dist\src\test\main.js
if errorlevel 1 (
    echo [ERROR] Tests failed.
    exit /b 1
)

echo ==^> Bundling JS
mkdir release
call "%ESBUILD%" dist\src\app\main.js --bundle --format=iife --target=es2020 --platform=browser --log-level=warning --outfile=release\bundle.tmp.js
if errorlevel 1 (
    echo [ERROR] Bundling failed.
    exit /b 1
)

echo ==^> Inlining into release\index.html
set HTML=src\index.html
set CSS=src\style.css
set JS=release\bundle.tmp.js
set OUT=release\index.html
node -e "const fs=require('fs');const html=fs.readFileSync(process.env.HTML,'utf8');const css=fs.readFileSync(process.env.CSS,'utf8');const js=fs.readFileSync(process.env.JS,'utf8');const out=html.replace(/\s*<link\s+rel=\"stylesheet\"[^>]*>\s*/i,'\n    <style>\n'+css+'\n    </style>\n  ').replace(/\s*<script\b[^>]*><\/script>\s*/i,'\n    <script>\n'+js+'\n    </script>\n  ');fs.writeFileSync(process.env.OUT,out);"
if errorlevel 1 (
    echo [ERROR] Inlining failed.
    exit /b 1
)
del "%JS%"

for %%A in ("%OUT%") do echo ==^> BUILD OK (%%~zA bytes)
