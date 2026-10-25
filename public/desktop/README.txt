Cadence Desktop — Windows Spotify controls

1. Keep these files together in one folder.
2. Double-click Start-Cadence-Desktop.cmd.
3. The helper runs hidden in the background. Its local page opens with a pairing code.
4. In Cadence Settings, choose Spotify > Windows desktop, paste that code, and connect.
5. Select a song in the Spotify desktop app and start a focus timer in Cadence.

No Spotify developer account, Premium subscription, third-party libraries, admin rights,
startup task, or Spotify password is needed. Uses Windows PowerShell 5.1 and the
Windows media session API. If Windows blocks a downloaded script, review it and use
the file's Properties > Unblock option yourself; do not change machine-wide policy.
If the launcher does not start, run this from its folder to see the error:
  powershell.exe -NoProfile -File .\Cadence-Desktop.ps1

The browser may ask for local-network access to connect to this helper.
The listener binds only to 127.0.0.1:17842. Only the Cadence production origin and
the local development origins on port 8787 can pair or send requests. A random code
is generated each run. Pairing and playback metadata stay on this computer.

The paired tab sends a focus deadline and a short heartbeat lease. Music pauses
when focus stops, the deadline expires, or heartbeats stop for up to 90 seconds (to allow background-tab throttling).
The helper never sends a generic play/pause media key: only Spotify is targeted.
Pairing does not take over idle playback. A running focus session takes control
until its pause or completion boundary, then releases control. If you manually
resume Spotify afterward, Cadence does not repeatedly pause it while idle.
Spotify Free's ad, skip, and seek restrictions still apply. Unsupported controls
are disabled; no restrictions are bypassed.

To stop: open http://127.0.0.1:17842/ and click Stop helper.
Start it again after restarting Windows. It does not install itself at login.
