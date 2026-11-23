# Publishes Shop Alarm to a GitHub repository: the website into docs/ (for GitHub Pages) and the readable
# source code next to it. Uses GitHub's web API, so git doesn't need to be installed.
#   github-repo.txt   owner/name of the repository (e.g. yourname/shop-alarm)
#   github-token.txt  a fine-grained token for that one repository with "Contents: Read and write"
# Both files stay on this PC and are never uploaded. docs/backend.json (where the server is) is left alone
# if it's already there: the spare PC keeps it up to date.
# Run:  powershell -ExecutionPolicy Bypass -File publish-to-github.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = (Get-Content (Join-Path $here 'github-repo.txt') -Raw).Trim()
# the token: from github-token.txt if there is one, otherwise from GitHub's own gh tool's sign-in
# (tools\gh.exe, signed in with "gh auth login"); it's only kept in memory here
$tokenFile = Join-Path $here 'github-token.txt'
$token = if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } else { (& (Join-Path $here 'tools\gh.exe') auth token).Trim() }
if (-not $token) { throw 'Not signed in to GitHub: run  tools\gh.exe auth login --web  first' }
$h = @{ Authorization = "Bearer $token"; 'User-Agent' = 'shop-alarm-publisher'; Accept = 'application/vnd.github+json' }
$base = "https://api.github.com/repos/$repo/contents"

Push-Location $here; node build-extension.js | Out-Null; Pop-Location

# what goes up: repository path -> local file
$files = [ordered]@{}
foreach ($f in 'README.md', 'main.js', 'preload.js', 'panel.html', 'icon-extractor.js', 'build-extension.js', 'make-server-pack.ps1', 'publish-to-github.ps1', 'package.json', 'icon.png', 'icon.ico', 'Start Shop Alarm.bat') { if (Test-Path (Join-Path $here $f)) { $files[$f] = Join-Path $here $f } }
foreach ($dir in 'extension-src', 'web-src', 'server-pack-src') {
  Get-ChildItem (Join-Path $here $dir) -Recurse -File | Where-Object { $_.Name -notin 'cloudflared.exe', 'github-token.txt' } | ForEach-Object {
    $files[($_.FullName.Substring($here.Length + 1) -replace '\\', '/')] = $_.FullName }
}
Get-ChildItem (Join-Path $here 'web') -Recurse -File | ForEach-Object { $files['docs/' + ($_.FullName.Substring((Join-Path $here 'web').Length + 1) -replace '\\', '/')] = $_.FullName }
$files['docs/.nojekyll'] = $null   # serve the files as they are

function Put($path, [byte[]]$bytes, $message) {
  $url = "$base/" + ((($path -split '/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/')
  $sha = $null; $same = $false
  try { $cur = Invoke-RestMethod $url -Headers $h; $sha = $cur.sha; $same = (($cur.content -replace '\s', '') -eq [Convert]::ToBase64String($bytes)) } catch {}
  if ($same) { return 'same' }
  $body = @{ message = $message; content = [Convert]::ToBase64String($bytes) }
  if ($sha) { $body.sha = $sha }
  Invoke-RestMethod $url -Method Put -Headers $h -Body ($body | ConvertTo-Json) -ContentType 'application/json' | Out-Null
  if ($sha) { 'updated' } else { 'added' }
}

$count = @{ added = 0; updated = 0; same = 0 }
foreach ($p in $files.Keys) {
  $bytes = if ($files[$p]) { [IO.File]::ReadAllBytes($files[$p]) } else { [byte[]]@() }
  $r = Put $p $bytes "Update $p"; $count[$r]++
  "{0,-8} {1}" -f $r, $p
}
# where the server is: only create it if missing (the spare PC updates it)
try { Invoke-RestMethod "$base/docs/backend.json" -Headers $h | Out-Null } catch { Put 'docs/backend.json' ([Text.Encoding]::UTF8.GetBytes('{"api":""}')) 'Add backend.json' | Out-Null; 'added    docs/backend.json' }
$owner, $name = $repo.Split('/')
"Done: $($count.added) added, $($count.updated) updated, $($count.same) unchanged. Site: https://$($owner.ToLower()).github.io/$name/"
