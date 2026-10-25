# No UI, keyboard input or Spotify access. Real command policy with fake dependencies.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../public/desktop/Cadence-Desktop.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw $errors[0]}
foreach($name in @('Get-TrackKey','Invoke-LikeSong')){
  $fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
  Invoke-Expression $fn.Extent.Text
}
$focusFn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Focus-SpotifyWindow'},$true)
$source=$focusFn.Find({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.Value.StartsWith('using System;')},$true)
Add-Type -TypeDefinition $source.Value # Compile declarations only; no native calls are made.
$script:now=1000000L;$script:sends=0;$script:focuses=0;$script:focusAllowed=$true;$script:changed=$false;$script:reads=0
$script:key='a'*64;$script:lastLikeTrack='';$script:lastLikeAt=0L;$script:available=$true
function Now-Ms{return $script:now}
function Get-Status([switch]$Fresh){$script:reads++;$key=if($script:changed -and $script:reads -gt 1){'b'*64}else{$script:key};return @{available=$script:available;trackKey=$key;controls=@{like=$script:available}}}
function Get-SpotifyWindow{return @{Handle=1;ProcessId=99}}
function Focus-SpotifyWindow($Target){$script:focuses++;return $script:focusAllowed}
function Send-SpotifyLikeShortcut($Target){$script:sends++}
function Check($Condition,$Message){if(-not $Condition){throw $Message}}
$result=Invoke-LikeSong $script:key;Check ($result.ok -and $script:sends -eq 1) 'One explicit action sends one shortcut.'
[void](Invoke-LikeSong $script:key);Check ($script:sends -eq 1) 'Double clicks must not immediately undo a like.'
$script:now+=3000;$blocked=$false;try{Invoke-LikeSong ('c'*64)}catch{$blocked=$true};Check ($blocked -and $script:sends -eq 1) 'A stale song must not be toggled.'
$script:focusAllowed=$false;$blocked=$false;try{Invoke-LikeSong $script:key}catch{$blocked=$true};Check ($blocked -and $script:sends -eq 1) 'No shortcut is sent to another foreground app.'
$script:focusAllowed=$true;$script:changed=$true;$script:reads=0;$blocked=$false;try{Invoke-LikeSong $script:key}catch{$blocked=$true};Check ($blocked -and $script:sends -eq 1) 'A song changing while Spotify opens cancels the shortcut.'
$script:changed=$false;$script:available=$false;$blocked=$false;try{Invoke-LikeSong $script:key}catch{$blocked=$true};Check ($blocked -and $script:sends -eq 1) 'Unavailable items cannot be liked.'
$a=Get-TrackKey @{Title='Song';Artist='Artist';AlbumTitle='One'};$b=Get-TrackKey @{Title='Song';Artist='Artist';AlbumTitle='Two'};Check ($a -ne $b -and $a.Length -eq 64) 'Album changes are part of song identity.'
Write-Output 'Like policy and native declarations passed: explicit action, debounce, fresh song identity and foreground guard. No real UI or library was changed.'
