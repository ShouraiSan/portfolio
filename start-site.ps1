$siteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$vite = Join-Path $siteRoot 'node_modules\.pnpm\vite@8.2.2\node_modules\vite\bin\vite.js'
$port = 5173
$running = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $running) {
  Start-Process -FilePath $node -ArgumentList "`"$vite`" --host 127.0.0.1 --port $port" -WorkingDirectory $siteRoot -WindowStyle Hidden
  Start-Sleep -Seconds 2
}
Start-Process "http://127.0.0.1:$port/"
