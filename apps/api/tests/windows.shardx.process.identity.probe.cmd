@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows.shardx.process.identity.probe.ps1"
set "probeExitCode=%ERRORLEVEL%"
echo.
echo Probe finished with exit code %probeExitCode%. Press any key to close this window.
pause >nul
exit /b %probeExitCode%
