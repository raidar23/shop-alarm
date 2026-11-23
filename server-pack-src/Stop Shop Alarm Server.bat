@echo off
rem Stops the Shop Alarm website server and its public link.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h = '%~dp0'.TrimEnd('\'); Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like ('*' + $h + '\app*--server*') -or $_.CommandLine -like ('*' + $h + '\cloudflared.exe*')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($h + '\*') } | Stop-Process -Force -ErrorAction SilentlyContinue"
echo Shop Alarm server stopped.
timeout /t 2 >nul
