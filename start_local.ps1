$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$knownHosts = Join-Path $env:USERPROFILE '.codex\overtiq_known_hosts'
$keyCandidates = @(
  $env:OVERTIQ_SSH_KEY,
  (Join-Path $env:USERPROFILE '.ssh\id_ed25519_vast'),
  'C:\Users\Windows 10\.ssh\id_ed25519_vast',
  (Join-Path $env:USERPROFILE '.codex\overtiq_key2')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $keyCandidates) { throw 'Set OVERTIQ_SSH_KEY to the Vast SSH key path before starting the local terminal.' }
$key = $keyCandidates[0]

function Test-Port($port) { return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function Test-GpuHealth {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:10200/health' -UseBasicParsing -TimeoutSec 4
    return $response.StatusCode -eq 200
  } catch { return $false }
}

# A stale SSH process can keep the local port open after its remote channel has
# died. Test the forwarded service itself, and recycle only the tunnel that
# owns this exact local forward when the health probe fails.
if (-not (Test-GpuHealth)) {
  Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
    Where-Object { $_.CommandLine -match '-L\s+127\.0\.0\.1:10200:127\.0\.0\.1:10200' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $sshArgs = @('-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=no','-o',"UserKnownHostsFile=$knownHosts",'-o','ServerAliveInterval=30','-o','ExitOnForwardFailure=yes','-L','127.0.0.1:10200:127.0.0.1:10200','-i',$key,'-p','41103','root@122.59.250.166')
  Start-Process -FilePath 'ssh.exe' -ArgumentList $sshArgs -WindowStyle Hidden | Out-Null
  $healthy = $false
  1..10 | ForEach-Object {
    if (Test-GpuHealth) { $healthy = $true; return }
    Start-Sleep -Milliseconds 500
  }
  if (-not $healthy) { throw 'GPU tunnel started but the forwarded service did not answer /health.' }
}
if (-not (Test-Port 4173)) {
  Start-Process -FilePath 'python.exe' -ArgumentList @('-m','http.server','4173','--directory',(Join-Path $projectRoot 'dist')) -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
}
Write-Output 'GPU tunnel: http://127.0.0.1:10200'
Write-Output 'Race engineer terminal: http://localhost:4173'
