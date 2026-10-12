$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'CI-only cleanup' }
if ($env:MYSSH_TEST_WSL_DISTRO) {
  if ($env:MYSSH_TEST_WSL_DISTRO -notmatch '^MySSH-CI-\d+-\d+-[a-f0-9]{8}$') { throw 'Unexpected distribution name; refusing cleanup' }
  & "$env:SystemRoot\System32\wsl.exe" --unregister $env:MYSSH_TEST_WSL_DISTRO
  if ($LASTEXITCODE -ne 0) { throw 'WSL cleanup failed' }
}
