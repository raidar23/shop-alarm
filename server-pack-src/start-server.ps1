# Starts the Shop Alarm website server on this PC and puts it on the internet.
#  1. starts the app in server mode (no window: just the shop watcher and the website on http://localhost:8787)
#  2. starts Cloudflare's free tunnel (cloudflared) to give the website a public https link
#  3. writes that link to "public-link.txt", copies it, and shows it
# Run it with "Start Shop Alarm Server.bat". Stop everything with "Stop Shop Alarm Server.bat".
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8787
$electron = Join-Path $here 'runtime\electron.exe'
$appDir = Join-Path $here 'app'
$cloudflared = Join-Path $here 'cloudflared.exe'
$tunnelLog = Join-Path $here 'tunnel.log'
$linkFile = Join-Path $here 'public-link.txt'
Add-Type -AssemblyName System.Windows.Forms

function Running($pattern) { @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like $pattern }).Count -gt 0 }

# 1. the server (skip if it's already running)
if (-not (Running "*$appDir*--server*")) {
  Start-Process -FilePath $electron -ArgumentList "`"$appDir`"", '--server' -WorkingDirectory $appDir -WindowStyle Hidden
}
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "http://localhost:$port/api/state" -TimeoutSec 3 | Out-Null; $up = $true } catch { Start-Sleep 2 }
}
if (-not $up) { [System.Windows.Forms.MessageBox]::Show("The Shop Alarm server didn't start. Try again, or restart the PC.", 'Shop Alarm server') | Out-Null; exit 1 }

# 2. the tunnel (a fresh one each time: the free link changes when the tunnel restarts)
Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $cloudflared } | Stop-Process -Force
Remove-Item $tunnelLog -ErrorAction SilentlyContinue
Start-Process -FilePath $cloudflared -ArgumentList 'tunnel', '--url', "http://localhost:$port", '--no-autoupdate', '--logfile', "`"$tunnelLog`"" -WindowStyle Hidden

# 3. the public link
$link = $null
for ($i = 0; $i -lt 60 -and -not $link; $i++) {
  Start-Sleep 1
  if (Test-Path $tunnelLog) { $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $link = $m.Matches[0].Value } }
}
if (-not $link) { [System.Windows.Forms.MessageBox]::Show("The website is running at http://localhost:$port but the public link didn't come up. Check the internet connection and run this again.", 'Shop Alarm server') | Out-Null; exit 1 }
Set-Content -Path $linkFile -Value $link -Encoding utf8

# 4. if the website is on GitHub Pages (github-repo.txt + github-token.txt in this folder), tell it where the
#    server is now, by updating docs/backend.json in the repo. Visitors keep using the github.io link.
#    The permission comes from github-token.txt if there is one, else from the gh tool's sign-in
#    ("Sign in to GitHub.bat"); it's only kept in memory here.
$repoFile = Join-Path $here 'github-repo.txt'; $tokenFile = Join-Path $here 'github-token.txt'; $ghExe = Join-Path $here 'gh.exe'
$siteLink = $link; $ghNote = ''
$token = if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } elseif (Test-Path $ghExe) { try { (& $ghExe auth token 2>$null | Out-String).Trim() } catch { '' } } else { '' }
if ((Test-Path $repoFile) -and $token) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $repo = (Get-Content $repoFile -Raw).Trim()
    $api = "https://api.github.com/repos/$repo/contents/docs/backend.json"
    $h = @{ Authorization = "Bearer $token"; 'User-Agent' = 'shop-alarm-server'; Accept = 'application/vnd.github+json' }
    $sha = $null; try { $sha = (Invoke-RestMethod $api -Headers $h).sha } catch {}
    $json = @{ api = "$link/"; updated = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
    $body = @{ message = 'Update where the Shop Alarm server is'; content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)) }
    if ($sha) { $body.sha = $sha }
    Invoke-RestMethod $api -Method Put -Headers $h -Body ($body | ConvertTo-Json) -ContentType 'application/json' | Out-Null
    $owner, $name = $repo.Split('/')
    $siteLink = "https://$($owner.ToLower()).github.io/$name/"
    $ghNote = "`n`nIt's on GitHub Pages at the same address as always (it can take a few minutes to catch up):`n$siteLink"
  } catch { $ghNote = "`n`n(Couldn't update GitHub: $($_.Exception.Message). Check github-token.txt.)" }
}
Set-Clipboard -Value $siteLink
if (-not $env:SHOPALARM_QUIET) {
  [System.Windows.Forms.MessageBox]::Show("The Shop Alarm website is online:`n`n$link$ghNote`n`n(Copied. The tunnel link is also saved in public-link.txt.)", 'Shop Alarm server') | Out-Null
}
