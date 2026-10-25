# Exercises the helper's actual control functions with a fake media session.
# Does not load Windows media APIs, open a port, or access Spotify.
$ErrorActionPreference='Stop'
$tokens=$null;$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../public/desktop/Cadence-Desktop.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw $parseErrors[0]}
$functions=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Pause-Spotify','Guard-Focus','Media-Command')},$true)
foreach($fn in $functions){Invoke-Expression $fn.Extent.Text}
class FakeSession {
  [int]$Plays=0
  [int]$Pauses=0
  [object]$Info=@{PlaybackStatus='Playing';Controls=@{IsPlayEnabled=$true;IsPauseEnabled=$true}}
  [object]GetPlaybackInfo(){return $this.Info}
  [bool]TryPlayAsync(){$this.Plays++;$this.Info.PlaybackStatus='Playing';return $true}
  [bool]TryPauseAsync(){$this.Pauses++;$this.Info.PlaybackStatus='Paused';return $true}
}
$script:fake=[FakeSession]::new()
function Get-Spotify {return $script:fake}
function Now-Ms {return 1000000L}
function Await-WinRT($Operation,[Type]$Type){return $Operation}
function Check([bool]$value,[string]$message){if(-not $value){throw $message}}
$script:armed=$true;$script:controlling=$false;$script:focusUntil=0L;$script:hadFocus=$false
Guard-Focus
Check ($fake.Pauses -eq 0) 'Pairing must not pause manually playing music.'
$script:controlling=$true;Guard-Focus
Check ($fake.Pauses -eq 1) 'An owned focus boundary pauses once.'
$fake.Info.PlaybackStatus='Playing';Guard-Focus;Guard-Focus
Check ($fake.Pauses -eq 1) 'Idle watchdog must respect manual playback after releasing control.'
$blocked=$false;try{Media-Command 'play'}catch{$blocked=$true}
Check $blocked 'Play must be refused outside focus.'
$fake.Info.PlaybackStatus='Paused';$script:focusUntil=1060000L
Media-Command 'play'
Check ($fake.Plays -eq 1 -and $script:controlling) 'A focus start acquires playback control.'
Guard-Focus
Check ($fake.Pauses -eq 1) 'An active focus lease does not pause music.'
$script:focusUntil=999999L;Guard-Focus
Check ($fake.Pauses -eq 2 -and -not $script:controlling) 'Deadline expiry pauses and releases control.'
Write-Output 'Desktop control policy passed with a fake session: no idle takeover, one pause per boundary, manual playback respected, and absolute deadline enforcement.'
