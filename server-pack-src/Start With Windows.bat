@echo off
rem Makes the Shop Alarm server start by itself whenever you sign in to this PC
rem (adds a shortcut to your Startup folder; delete "Shop Alarm Server" there to undo).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = New-Object -ComObject WScript.Shell; $l = $s.CreateShortcut([Environment]::GetFolderPath('Startup') + '\Shop Alarm Server.lnk'); $l.TargetPath = '%~dp0Start Shop Alarm Server.bat'; $l.WorkingDirectory = '%~dp0'; $l.WindowStyle = 7; $l.IconLocation = '%~dp0app\icon.ico,0'; $l.Save()"
echo The Shop Alarm server will now start when you sign in to this PC.
pause
