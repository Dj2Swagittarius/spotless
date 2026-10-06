@echo off
rem Stops the Spotless AI DJ test stack. Data and downloaded models are kept (named volumes).
cd /d "%~dp0"
docker compose down
