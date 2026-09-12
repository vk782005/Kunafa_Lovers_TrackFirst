$ErrorActionPreference = 'Stop'

# The frontend and GPU API share the Vast-mapped FastAPI origin. This launcher
# only verifies that origin and opens it; it does not create an SSH tunnel or
# run a second local web server.
$terminalUrl = 'http://122.59.250.166:41138/'
$healthUrl = $terminalUrl + 'health'
$health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 10

if ($health.status -ne 'ok' -or -not $health.gpu.available) {
  throw 'The Overtiq GPU service is not healthy.'
}

Start-Process $terminalUrl
Write-Output ('Race engineer terminal: ' + $terminalUrl)
Write-Output ('GPU: ' + $health.gpu.device)
