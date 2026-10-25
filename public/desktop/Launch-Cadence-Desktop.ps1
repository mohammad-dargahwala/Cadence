param([switch]$NoBrowser,[int]$StartupTimeoutSeconds=20)
$ErrorActionPreference='Stop'
$address='http://127.0.0.1:17842/'
function Test-CadenceReady {
  try {
    $request=[Net.HttpWebRequest]::Create($address+'health');$request.Timeout=500;$request.Proxy=$null
    $response=$request.GetResponse()
    try {$reader=[IO.StreamReader]::new($response.GetResponseStream());$data=$reader.ReadToEnd() | ConvertFrom-Json;return $data.ok -eq $true -and $data.service -eq 'cadence-desktop'}finally{$response.Dispose()}
  }catch{return $false}
}
if(Test-CadenceReady){if(-not $NoBrowser){Start-Process $address};Write-Output 'Cadence Desktop is already ready.';exit 0}
$scriptFile=Join-Path $PSScriptRoot 'Cadence-Desktop.ps1'
if(-not (Test-Path -LiteralPath $scriptFile)){throw 'Extract the entire ZIP first. Keep the launcher and Cadence-Desktop.ps1 in the same folder.'}
$logBase=Join-Path ([IO.Path]::GetTempPath()) ('Cadence-Desktop-'+[DateTime]::Now.ToString('yyyyMMdd-HHmmss')+'-'+$PID)
$arguments='-NoProfile -File '+[char]34+$scriptFile+[char]34
$process=Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList $arguments -RedirectStandardOutput ($logBase+'.log') -RedirectStandardError ($logBase+'.error.log') -PassThru
$until=[DateTime]::UtcNow.AddSeconds([Math]::Max(5,[Math]::Min(60,$StartupTimeoutSeconds)))
do {
  if(Test-CadenceReady){
    if(-not $NoBrowser){Start-Process $address}
    Write-Output ('Cadence Desktop is ready. Process '+$process.Id+'. No playback control is active until you pair a Cadence tab and run focus.')
    exit 0
  }
  if($process.HasExited){break}
  Start-Sleep -Milliseconds 250
}while([DateTime]::UtcNow -lt $until)
$detail=if(Test-Path -LiteralPath ($logBase+'.error.log')){Get-Content -LiteralPath ($logBase+'.error.log') -Raw}else{''}
if($detail.Length -gt 3000){$detail=$detail.Substring(0,3000)}
throw ("Cadence Desktop did not start. The pairing page was not opened. Extract all files to a local folder and retry. If Windows reports a blocked downloaded file, review the ZIP's Properties > Unblock option yourself; no system policy change is needed.`nDiagnostic log: "+$logBase+".error.log`n"+$detail)
