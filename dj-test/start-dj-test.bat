@echo off
rem Starts the Spotless AI DJ test stack and opens the DJ page.
cd /d "%~dp0"
docker compose up -d --build || (echo Docker failed. Is Docker Desktop running? & pause & exit /b 1)
echo Waiting for Spotless on http://localhost:3300 ...
:wait
curl -s -o nul http://localhost:3300/api/users || (timeout /t 2 /nobreak >nul & goto wait)
start "" http://localhost:3300/dj
