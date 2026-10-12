$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This script only creates a disposable distribution on a GitHub-hosted Windows runner.'
}
$taskRoot = Join-Path $env:RUNNER_TEMP ('myssh-wsl-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$distro = 'MySSH-CI-' + $env:GITHUB_RUN_ID + '-' + $env:GITHUB_RUN_ATTEMPT + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$archive = Join-Path $taskRoot 'rootfs.tar.gz'
Invoke-WebRequest -Uri 'https://dl-cdn.alpinelinux.org/alpine/v3.23/releases/x86_64/alpine-minirootfs-3.23.6-x86_64.tar.gz' -OutFile $archive -TimeoutSec 60
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '6fc0e3639a1c01f156970d7626aab90bc90697117069dbc39ad880b84efa319a') {
  throw 'Alpine rootfs SHA-256 mismatch'
}
$inputStream = [IO.File]::OpenRead($archive)
$gzip = [IO.Compression.GZipStream]::new($inputStream, [IO.Compression.CompressionMode]::Decompress)
$outputStream = [IO.File]::Create((Join-Path $taskRoot 'rootfs.tar'))
try { $gzip.CopyTo($outputStream) } finally { $outputStream.Dispose(); $gzip.Dispose(); $inputStream.Dispose() }
"MYSSH_TEST_WSL_DISTRO=$distro" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
& "$env:SystemRoot\System32\wsl.exe" --import $distro (Join-Path $taskRoot 'distribution') (Join-Path $taskRoot 'rootfs.tar') --version 1
if ($LASTEXITCODE -ne 0) { throw 'WSL import failed' }
& "$env:SystemRoot\System32\wsl.exe" --distribution $distro --exec /bin/echo WSL_READY
if ($LASTEXITCODE -ne 0) { throw 'WSL distribution could not start' }
