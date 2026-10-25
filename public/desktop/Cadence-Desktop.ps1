param([switch]$StatusOnly, [int]$Port = 17842)
# Windows PowerShell 5.1. Uses Spotify's Windows media session; no Spotify credentials.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$mediaType=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-WinRT($Operation,[Type]$Type) {
  $task=$asTask.MakeGenericMethod($Type).Invoke($null,@($Operation))
  if(-not $task.Wait(2500)){throw 'Windows media operation timed out.'}
  return $task.Result
}
$manager=Await-WinRT ($managerType::RequestAsync()) $managerType
function Get-Spotify {
  return $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match '^(Spotify\.exe|Spotify|SpotifyAB\.SpotifyMusic_[^!]+!Spotify)$' } | Select-Object -First 1
}
if($StatusOnly){
  $session=Get-Spotify
  if($session){@{found=$true;app=$session.SourceAppUserModelId;playing=([string]$session.GetPlaybackInfo().PlaybackStatus -eq 'Playing')} | ConvertTo-Json -Compress}
  else{'{"found":false}'}
  exit
}
$script:armed=$false;$script:controlling=$false;$script:focusUntil=0L;$script:hadFocus=$false;$script:client='';$script:stop=$false
$script:metadata=$null;$script:metadataAt=0L;$script:art='';$script:trackKey=''
function Now-Ms {return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
function Pause-Spotify {
  $session=Get-Spotify
  if($session -and [string]$session.GetPlaybackInfo().PlaybackStatus -eq 'Playing') {[void](Await-WinRT ($session.TryPauseAsync()) ([bool]))}
}
function Guard-Focus {
  if(-not $script:armed -or -not $script:controlling){return}
  if((Now-Ms) -ge $script:focusUntil){$script:hadFocus=$false;Pause-Spotify;$script:controlling=$false}
}
function Read-Art($Thumbnail) {
  if(-not $Thumbnail){return ''}
  $stream=$null;$reader=$null
  try {
    $stream=Await-WinRT ($Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime])
    if($stream.Size -gt 1048576 -or $stream.Size -lt 4){return ''}
    $reader=[Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]::new($stream.GetInputStreamAt(0))
    [void](Await-WinRT ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]))
    $bytes=New-Object byte[] ([int]$stream.Size);$reader.ReadBytes($bytes)
    $mime=if($bytes[0] -eq 137 -and $bytes[1] -eq 80 -and $bytes[2] -eq 78 -and $bytes[3] -eq 71){'image/png'}elseif($bytes[0] -eq 255 -and $bytes[1] -eq 216){'image/jpeg'}else{''}
    if(-not $mime){return ''}
    return 'data:'+$mime+';base64,'+[Convert]::ToBase64String($bytes)
  } catch {return ''} finally {if($reader){try{$reader.Dispose()}catch{}};if($stream){try{$stream.Dispose()}catch{}}}
}
function Get-Status {
  $session=Get-Spotify
  if(-not $session){return @{connected=$true;available=$false;playing=$false;message='Open Spotify and select a song.'}}
  $info=$session.GetPlaybackInfo();$controls=$info.Controls;$timeline=$session.GetTimelineProperties()
  if((Now-Ms)-$script:metadataAt -gt 2000){
    $script:metadata=Await-WinRT ($session.TryGetMediaPropertiesAsync()) $mediaType
    $script:metadataAt=Now-Ms
    $key=$script:metadata.Title+'|'+$script:metadata.Artist
    if($key -ne $script:trackKey){$script:trackKey=$key;$script:art=Read-Art $script:metadata.Thumbnail}
  }
  return @{connected=$true;available=$true;playing=([string]$info.PlaybackStatus -eq 'Playing');
    title=$script:metadata.Title;artist=$script:metadata.Artist;album=$script:metadata.AlbumTitle;artwork=$script:art;
    positionMs=[Math]::Max(0,($timeline.Position-$timeline.StartTime).TotalMilliseconds);
    durationMs=[Math]::Max(0,($timeline.EndTime-$timeline.StartTime).TotalMilliseconds);
    controls=@{play=$controls.IsPlayEnabled;pause=$controls.IsPauseEnabled;next=$controls.IsNextEnabled;previous=$controls.IsPreviousEnabled;seek=$controls.IsPlaybackPositionEnabled}}
}
function Media-Command([string]$Action) {
  $session=Get-Spotify;if(-not $session){throw 'Open Spotify and select a song first.'}
  $info=$session.GetPlaybackInfo();$c=$info.Controls
  switch($Action){
    'play' {if((Now-Ms) -ge $script:focusUntil){throw 'Playback is available during running focus intervals only.'};if([string]$info.PlaybackStatus -eq 'Playing'){$script:controlling=$true;return};if(-not $c.IsPlayEnabled){throw 'Spotify is not allowing playback right now.'};$op=$session.TryPlayAsync()}
    'pause' {if([string]$info.PlaybackStatus -ne 'Playing'){$script:controlling=$false;return};if(-not $c.IsPauseEnabled){throw 'Spotify is not allowing pause right now.'};$op=$session.TryPauseAsync()}
    'next' {if(-not $c.IsNextEnabled){throw 'Next track is unavailable in Spotify right now.'};$op=$session.TrySkipNextAsync()}
    'previous' {if(-not $c.IsPreviousEnabled){throw 'Previous track is unavailable in Spotify right now.'};$op=$session.TrySkipPreviousAsync()}
    {$_ -in 'back','forward'} {
      if(-not $c.IsPlaybackPositionEnabled){throw 'Seeking is unavailable for this Spotify item.'}
      $timeline=$session.GetTimelineProperties();$offset=if($Action -eq 'back'){-150000000L}else{150000000L}
      $ticks=[Math]::Max($timeline.StartTime.Ticks,[Math]::Min($timeline.EndTime.Ticks,$timeline.Position.Ticks+$offset))
      $op=$session.TryChangePlaybackPositionAsync($ticks)
    }
    default {throw 'Unknown media action.'}
  }
  if(-not (Await-WinRT $op ([bool]))){throw 'Spotify declined that control. Its current restrictions still apply.'}
  if($Action -eq 'play'){$script:controlling=$true}
  if($Action -eq 'pause'){$script:controlling=$false}
  Guard-Focus
}
$random=New-Object byte[] 24
$rng=[System.Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($random);$rng.Dispose()
$pairKey=[Convert]::ToBase64String($random).Replace('+','-').Replace('/','_').TrimEnd('=')
$allowedOrigins=@('https://cadence.mdargahwala.tech','http://127.0.0.1:8787','http://localhost:8787')
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
$listener.Start()
$utf8=[Text.UTF8Encoding]::new($false)
function Reply($Stream,[int]$Code,[string]$Body,[string]$Origin='', [string]$ContentType='application/json') {
  $bytes=$utf8.GetBytes($Body)
  $headers="HTTP/1.1 $Code Response`r`nContent-Type: $ContentType; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nX-Frame-Options: DENY`r`nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`r`n"
  if($Origin){$headers+="Access-Control-Allow-Origin: $Origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type, X-Cadence-Key, X-Cadence-Client`r`nAccess-Control-Allow-Private-Network: true`r`n"}
  $headers+="`r`n";$head=$utf8.GetBytes($headers);$Stream.Write($head,0,$head.Length);$Stream.Write($bytes,0,$bytes.Length)
}
Write-Host "Cadence Desktop is running at http://127.0.0.1:$Port/"
try {
  while(-not $script:stop){
    try {Guard-Focus} catch {}
    if(-not $listener.Pending()){Start-Sleep -Milliseconds 150;continue}
    $socket=$listener.AcceptTcpClient();$socket.ReceiveTimeout=1800;$socket.SendTimeout=1800;$stream=$socket.GetStream();$origin=''
    try {
      $buffer=[Collections.Generic.List[byte]]::new()
      do {
        $b=$stream.ReadByte();if($b -lt 0){throw 'Incomplete request.'};$buffer.Add([byte]$b)
        if($buffer.Count -gt 12288){throw 'Header too large.'}
        $n=$buffer.Count
      } until($n -ge 4 -and $buffer[$n-4] -eq 13 -and $buffer[$n-3] -eq 10 -and $buffer[$n-2] -eq 13 -and $buffer[$n-1] -eq 10)
      $lines=$utf8.GetString($buffer.ToArray()).Split(@("`r`n"),[StringSplitOptions]::None)
      $request=$lines[0].Split(' ');$method=$request[0];$route=$request[1];$headers=@{}
      foreach($line in $lines | Select-Object -Skip 1){$pos=$line.IndexOf(':');if($pos -gt 0){$headers[$line.Substring(0,$pos).ToLowerInvariant()]=$line.Substring($pos+1).Trim()}}
      if($headers['host'] -ne "127.0.0.1:$Port"){Reply $stream 403 '{"error":"Invalid host."}';continue}
      $origin=[string]$headers['origin']
      if($origin -and $origin -notin $allowedOrigins -and $origin -ne "http://127.0.0.1:$Port"){Reply $stream 403 '{"error":"Origin not allowed."}';continue}
      if($method -eq 'GET' -and $route -eq '/'){
        $page=@"
<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cadence Desktop</title><style>body{margin:8vh auto;max-width:540px;padding:24px;background:#101721;color:#eff7f4;font:16px/1.6 system-ui}h1{font-size:26px}code{display:block;background:#23332f;padding:16px;border-radius:12px;font-size:17px;overflow-wrap:anywhere;color:#a9e8ce}p{color:#b4c6be}button{padding:10px 16px;border:0;border-radius:8px;background:#b3e5d1;color:#10231d}</style><h1>Cadence Desktop is running</h1><p>In Cadence, open Settings / Spotify / Windows desktop. Paste this pairing code and choose Connect desktop.</p><code>$pairKey</code><p>This code is for this run only. It lets Cadence control Spotify on this computer. No Spotify login, Premium, or developer account is needed.</p><p>The helper enforces the focus deadline even when the browser is in the background. If the tab disappears, music pauses on its close signal or within 90 seconds of losing contact, whichever comes first.</p><form action="/stop" method="post"><input type="hidden" name="key" value="$pairKey"><button>Stop helper</button></form></html>
"@
        Reply $stream 200 $page '' 'text/html';continue
      }
      if($method -eq 'OPTIONS'){if(-not $origin){Reply $stream 403 '{}'}else{Reply $stream 204 '' $origin};continue}
      $length=0;if($headers.ContainsKey('content-length')){if(-not [int]::TryParse($headers['content-length'],[ref]$length) -or $length -lt 0 -or $length -gt 8192){throw 'Invalid body length.'}}
      if($headers.ContainsKey('transfer-encoding')){throw 'Transfer encoding is unsupported.'}
      $bytes=New-Object byte[] $length;$offset=0
      while($offset -lt $length){$read=$stream.Read($bytes,$offset,$length-$offset);if($read -eq 0){throw 'Incomplete body.'};$offset+=$read}
      $raw=$utf8.GetString($bytes)
      if($route -eq '/stop' -and $method -eq 'POST' -and $origin -eq "http://127.0.0.1:$Port" -and $raw -eq "key=$pairKey"){$script:stop=$true;if($script:controlling){Pause-Spotify};$script:controlling=$false;Reply $stream 200 '{"stopped":true}' $origin;continue}
      if($headers['x-cadence-key'] -cne $pairKey){Reply $stream 401 '{"error":"Pairing code is incorrect. Open the helper page for its current code."}' $origin;continue}
      if($route -eq '/pair' -and $method -eq 'POST'){
        $id=[string]$headers['x-cadence-client'];if($id -notmatch '^[a-f0-9]{32,64}$'){throw 'Invalid client id.'}
        if($script:controlling){Pause-Spotify};$script:controlling=$false;$script:client=$id;$script:armed=$true;$script:focusUntil=0L;$script:hadFocus=$false
        Reply $stream 200 (Get-Status | ConvertTo-Json -Compress -Depth 5) $origin;continue
      }
      if(-not $script:armed -or $headers['x-cadence-client'] -cne $script:client){Reply $stream 409 '{"error":"Connect this Cadence tab to the desktop helper again."}' $origin;continue}
      $body=if($raw){$raw | ConvertFrom-Json}else{$null}
      switch("$method $route"){
        'GET /status' {Guard-Focus;Reply $stream 200 (Get-Status | ConvertTo-Json -Compress -Depth 5) $origin}
        'POST /timer' {
          $until=0L
          $lease=if($body.background -eq $true){90000}else{10000}
          if($body.allowed -eq $true -and $body.deadline -is [ValueType]){$until=[Math]::Min([long]$body.deadline,(Now-Ms)+$lease)}
          $focus=$until -gt (Now-Ms);$script:focusUntil=$until
          if($focus -and -not $script:hadFocus){try{Media-Command 'play'}catch{}}
          $script:hadFocus=$focus;Guard-Focus
          Reply $stream 200 '{"ok":true}' $origin
        }
        'POST /command' {Media-Command ([string]$body.action);Reply $stream 200 (Get-Status | ConvertTo-Json -Compress -Depth 5) $origin}
        'POST /disconnect' {if($script:controlling){Pause-Spotify};$script:controlling=$false;$script:armed=$false;$script:hadFocus=$false;$script:focusUntil=0L;$script:client='';Reply $stream 200 '{"ok":true}' $origin}
        default {Reply $stream 404 '{"error":"Not found."}' $origin}
      }
    } catch {
      try {Reply $stream 400 (@{error=$_.Exception.Message}|ConvertTo-Json -Compress) $origin} catch {}
    } finally {$stream.Dispose();$socket.Dispose()}
  }
} finally {if($script:controlling){try{Pause-Spotify}catch{}};$listener.Stop()}
