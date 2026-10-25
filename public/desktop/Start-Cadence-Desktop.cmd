@echo off
set "CADENCE_SCRIPT=%~dp0Cadence-Desktop.ps1"
powershell.exe -NoProfile -Command "$launchArgs='-NoProfile -File '+[char]34+$env:CADENCE_SCRIPT+[char]34; Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $launchArgs; Start-Sleep -Milliseconds 1500; Start-Process 'http://127.0.0.1:17842/'"
