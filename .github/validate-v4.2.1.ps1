$ErrorActionPreference = "Stop"

$partNames = @(
  "01.txt", "02.txt", "03.txt",
  "04r1.txt", "04r2.txt", "04r3.txt", "04r4.txt",
  "04fix2.txt", "04fix3.txt", "04fix4.txt", "04fix5.txt", "04fix6.txt", "04fix7.txt",
  "05.txt", "06.txt", "07.txt", "08.txt"
)
$encoded = ($partNames | ForEach-Object { (Get-Content (Join-Path ".github/patch-parts" $_) -Raw).Trim() }) -join ""
$gzipPath = Join-Path $env:RUNNER_TEMP "resenhazinha-base.patch.gz"
$patchPath = Join-Path $env:RUNNER_TEMP "resenhazinha-base.patch"
[IO.File]::WriteAllBytes($gzipPath, [Convert]::FromBase64String($encoded))
python -c "import gzip,sys; open(sys.argv[2],'wb').write(gzip.open(sys.argv[1],'rb').read())" "$gzipPath" "$patchPath"
git apply --whitespace=nowarn $patchPath

$scripts = @(
  ".github/apply-server-exit-v3.0.5.py.gz.b64",
  ".github/apply-server-menu-v3.0.6.py.gz.b64",
  ".github/apply-voice-mixer-v3.1.0.py.gz.b64",
  ".github/apply-resenhazinha-v3.2.0.py.gz.b64"
)
$index = 0
foreach ($src in $scripts) {
  $index++
  $encoded = (Get-Content $src -Raw).Trim()
  $gzipPath = Join-Path $env:RUNNER_TEMP "resenhazinha-python-$index.py.gz"
  $scriptPath = Join-Path $env:RUNNER_TEMP "resenhazinha-python-$index.py"
  [IO.File]::WriteAllBytes($gzipPath, [Convert]::FromBase64String($encoded))
  python -c "import gzip,sys; open(sys.argv[2],'wb').write(gzip.open(sys.argv[1],'rb').read())" "$gzipPath" "$scriptPath"
  python "$scriptPath"
}

$patches = @(
  ".github/apply-ui-v3.2.1.patch.gz.b64",
  ".github/apply-voice-presence-v3.3.0.patch.gz.b64",
  ".github/apply-stability-v3.3.1.patch.gz.b64",
  ".github/apply-hotfix-v3.3.2.patch.gz.b64"
)
$index = 0
foreach ($src in $patches) {
  $index++
  $encoded = (Get-Content $src -Raw).Trim()
  $gzipPath = Join-Path $env:RUNNER_TEMP "resenhazinha-patch-$index.patch.gz"
  $patchPath = Join-Path $env:RUNNER_TEMP "resenhazinha-patch-$index.patch"
  [IO.File]::WriteAllBytes($gzipPath, [Convert]::FromBase64String($encoded))
  python -c "import gzip,sys; open(sys.argv[2],'wb').write(gzip.open(sys.argv[1],'rb').read())" "$gzipPath" "$patchPath"
  git apply --whitespace=nowarn $patchPath
}

function Decode-GzipBase64([string]$src, [string]$targetGzip, [string]$targetDecoded) {
  $encoded = (Get-Content $src -Raw).Trim()
  [IO.File]::WriteAllBytes($targetGzip, [Convert]::FromBase64String($encoded))
  python -c "import gzip,sys; open(sys.argv[2],'wb').write(gzip.open(sys.argv[1],'rb').read())" "$targetGzip" "$targetDecoded"
}

$gzipPath = Join-Path $env:RUNNER_TEMP "voice-routing.py.gz"
$scriptPath = Join-Path $env:RUNNER_TEMP "voice-routing.py"
Decode-GzipBase64 ".github/apply-voice-routing-v3.3.3.py.gz.b64" $gzipPath $scriptPath
python "$scriptPath"

$gzipPath = Join-Path $env:RUNNER_TEMP "cloud.patch.gz"
$patchPath = Join-Path $env:RUNNER_TEMP "cloud.patch"
Decode-GzipBase64 ".github/apply-cloud-v4.0.0.patch.gz.b64" $gzipPath $patchPath
git apply --whitespace=nowarn $patchPath

$gzipPath = Join-Path $env:RUNNER_TEMP "cloud-csp.py.gz"
$scriptPath = Join-Path $env:RUNNER_TEMP "cloud-csp.py"
Decode-GzipBase64 ".github/apply-cloud-csp-v4.0.1.py.gz.b64" $gzipPath $scriptPath
python "$scriptPath"

$gzipPath = Join-Path $env:RUNNER_TEMP "profile.patch.gz"
$patchPath = Join-Path $env:RUNNER_TEMP "profile.patch"
Decode-GzipBase64 ".github/apply-profile-sync-v4.0.2.patch.gz.b64" $gzipPath $patchPath
git apply --whitespace=nowarn $patchPath

$gzipPath = Join-Path $env:RUNNER_TEMP "chat.py.gz"
$scriptPath = Join-Path $env:RUNNER_TEMP "chat.py"
Decode-GzipBase64 ".github/apply-chat-v4.1.0.py.gz.b64" $gzipPath $scriptPath
python "$scriptPath"

$gzipPath = Join-Path $env:RUNNER_TEMP "chat-polish.patch.gz"
$patchPath = Join-Path $env:RUNNER_TEMP "chat-polish.patch"
Decode-GzipBase64 ".github/apply-chat-polish-v4.1.1.patch.gz.b64" $gzipPath $patchPath
git apply --whitespace=nowarn $patchPath

$path = "src/main.js"
$content = Get-Content $path -Raw
$content = $content.Replace('voiceLeave: "https://www.myinstants.com/media/sounds/y2mate_VKI8qDn.mp3"', 'voiceLeave: "https://www.myinstants.com/media/sounds/discord-leave-noise.mp3"')
$content = $content.Replace('screenStart: null,', 'screenStart: "https://www.myinstants.com/media/sounds/discord-stream-start_7MsfgpB.mp3",')
$content = $content.Replace('screenStop: null,', 'screenStop: "https://www.myinstants.com/media/sounds/discord-stream-stop.mp3",')
Set-Content -Path $path -Value $content -NoNewline -Encoding utf8

python ".github/apply-v4.2.0.py"
python ".github/apply-v4.2.1.py"

git diff --check
node --check src/main.js
node --check src/v4.2.0.js

if ((Get-Content "src/v4.2.0.js" -Raw) -notmatch 'CLEAN_BOOST_MAX = 200') {
  throw "O mixer visual não ficou em 200%."
}
$finalMain = Get-Content "src/main.js" -Raw
if ($finalMain -notmatch 'createPlaybackLimiter') { throw "Limiter não foi aplicado." }
if ($finalMain -notmatch 'connect\(gain\)\.connect\(limiter\)\.connect\(destination\)') { throw "Cadeia protegida não foi aplicada." }
Write-Host "Hotfix v4.2.1 validada: 200% preservado e limiter ativo."
