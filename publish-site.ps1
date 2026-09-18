param(
  [string]$Message = "Update portfolio website"
)

$siteRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$vite = Join-Path $siteRoot 'node_modules\vite\bin\vite.js'

Set-Location $siteRoot

if (-not (Test-Path $vite)) {
  throw '项目依赖不存在，请先运行 pnpm install。'
}

& $node $vite build
if ($LASTEXITCODE -ne 0) { throw '网站构建失败，已停止上传。' }

git add .
$changes = git status --porcelain
if (-not $changes) {
  Write-Host '没有需要上传的新修改。'
  exit 0
}

git commit -m $Message
if ($LASTEXITCODE -ne 0) { throw 'Git 提交失败。' }

git push
if ($LASTEXITCODE -ne 0) { throw 'GitHub 推送失败。' }

Write-Host '上传完成，GitHub Pages 将自动部署。'
