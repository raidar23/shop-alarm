# Builds the "ShopAlarmServer" folder to copy onto a spare PC: the app (run in server mode), the website,
# Electron's runtime, Cloudflare's tunnel tool, and the start/stop scripts from server-pack-src.
# Run:  powershell -ExecutionPolicy Bypass -File make-server-pack.ps1 [-Out <folder>]
param([string]$Out = (Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) '..\ShopAlarmServer'))
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = [IO.Path]::GetFullPath($Out)
$src = Join-Path $here 'server-pack-src'
$cf = Join-Path $src 'cloudflared.exe'
if (-not (Test-Path $cf)) { throw "cloudflared.exe is missing from server-pack-src (download it from https://github.com/cloudflare/cloudflared/releases)" }

# the website files come from the panel: rebuild them first
Push-Location $here; node build-extension.js | Out-Null; Pop-Location

if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $Out 'app') | Out-Null
foreach ($f in 'main.js', 'preload.js', 'panel.html', 'icon-extractor.js', 'icon.png', 'icon.ico', 'package.json') { Copy-Item (Join-Path $here $f) (Join-Path $Out "app\$f") }
Copy-Item (Join-Path $here 'web') (Join-Path $Out 'app\web') -Recurse
Copy-Item (Join-Path $here 'node_modules\electron\dist') (Join-Path $Out 'runtime') -Recurse
Copy-Item $cf (Join-Path $Out 'cloudflared.exe')
foreach ($f in 'start-server.ps1', 'Start Shop Alarm Server.bat', 'Stop Shop Alarm Server.bat', 'Start With Windows.bat', 'Sign in to GitHub.bat', 'README.txt') { Copy-Item (Join-Path $src $f) (Join-Path $Out $f) }
# GitHub Pages: the gh tool (for "Sign in to GitHub.bat") and which repository the site is in
$gh = Join-Path $here 'tools\gh.exe'
if (Test-Path $gh) { Copy-Item $gh (Join-Path $Out 'gh.exe') }
$repoFile = Join-Path $here 'github-repo.txt'
if (Test-Path $repoFile) { Copy-Item $repoFile (Join-Path $Out 'github-repo.txt') }

$size = (Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
"Built the server pack in $Out ({0:N0} MB)" -f $size
