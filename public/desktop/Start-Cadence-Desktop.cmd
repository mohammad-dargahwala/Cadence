@echo off
powershell.exe -NoProfile -File "%~dp0Launch-Cadence-Desktop.ps1"
if errorlevel 1 pause
