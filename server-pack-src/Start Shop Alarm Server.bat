@echo off
rem Starts the Shop Alarm website server and its public link (see start-server.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0start-server.ps1"
