@echo off
rem Signs this PC in to GitHub (once), so the server can keep the GitHub Pages site pointed at it.
rem It shows a short code and opens GitHub: enter the code there and click Authorize.
echo Signing this PC in to GitHub for the Shop Alarm website...
echo.
"%~dp0gh.exe" auth login --hostname github.com --git-protocol https --web
echo.
"%~dp0gh.exe" auth status
echo.
echo Done. Start the server with "Start Shop Alarm Server.bat".
pause
