param(
  [string]$Message = "Update portfolio website"
)

$siteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$vite = Join-Path $siteRoot 'node_modules\vite\bin\vite.js'

Set-Location $siteRoot

if (-not (Test-Path $vite)) {
  throw 'Project dependencies are missing. Run pnpm install first.'
}

& $node $vite build
if ($LASTEXITCODE -ne 0) { throw 'Website build failed. Upload stopped.' }

git add .
$changes = git status --porcelain
if (-not $changes) {
  Write-Host 'No new changes to upload.'
  exit 0
}

git commit -m $Message
if ($LASTEXITCODE -ne 0) { throw 'Git commit failed.' }

git push
if ($LASTEXITCODE -ne 0) { throw 'GitHub push failed.' }

Write-Host 'Upload complete. GitHub Pages will deploy automatically.'
