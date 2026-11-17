@echo off
cd /d "%~dp0"
title Internal AI QA Testing Platform
echo ==========================================================
echo Starting Internal AI QA Testing Platform...
echo Dashboard: http://localhost:3001
echo ==========================================================

start "QA Launcher" /min node apps\launcher\launcher.js --server http://localhost:3001
if exist "C:\nvm4w\nodejs\node.exe" (
    "C:\nvm4w\nodejs\node.exe" services\api\server.js
) else (
    node services\api\server.js
)
pause

