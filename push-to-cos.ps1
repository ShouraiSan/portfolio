# 本地兜底上传脚本：当 GitHub Actions 不可用（或临时改版）时用这个手动发布到腾讯云 COS
#
# 用法：
#   1. 先在当前 PowerShell 会话里设置环境变量（不要写进任何文件、不要提交到 Git）：
#        $env:TENCENT_CLOUD_SECRET_ID  = "你的SecretId"
#        $env:TENCENT_CLOUD_SECRET_KEY = "你的SecretKey"
#        $env:TENCENT_COS_BUCKET       = "你的桶名全称，例如 portfolio-1250000000"
#        $env:TENCENT_COS_REGION       = "你的地域，例如 ap-guangzhou"
#   2. 执行： pwsh -File .\push-to-cos.ps1
#      可选参数：
#        -SkipBuild    跳过 pnpm run build，直接上传现有产物
#        -SyncDelete   上传后删除 COS 上多余的旧文件（需要 cos:DeleteObject 权限）
#
# 缓存策略与 CI 一致：assets 长期强缓存、favicon 中等缓存、HTML 不缓存。
#
# 脚本不会记录、打印或上传上述密钥，只在本机内存中传给 coscmd。

[CmdletBinding()]
param(
  [string]$SourceDir = "dist",
  [switch]$SkipBuild,
  [switch]$SyncDelete
)

$ErrorActionPreference = "Stop"

$required = @(
  "TENCENT_CLOUD_SECRET_ID",
  "TENCENT_CLOUD_SECRET_KEY",
  "TENCENT_COS_BUCKET",
  "TENCENT_COS_REGION"
)

$missing = $required | Where-Object { -not (Get-Item "Env:$_" -ErrorAction SilentlyContinue) }
if ($missing) {
  Write-Host "缺少环境变量：" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Write-Host ""
  Write-Host "请按脚本头部注释在本次会话中设置后重试（不要在文件里保存密钥）。" -ForegroundColor Yellow
  exit 1
}

$secretId  = $env:TENCENT_CLOUD_SECRET_ID
$secretKey = $env:TENCENT_CLOUD_SECRET_KEY
$bucket    = $env:TENCENT_COS_BUCKET
$region    = $env:TENCENT_COS_REGION

if (-not $SkipBuild) {
  Write-Host "==> 构建静态站点 (pnpm run build)" -ForegroundColor Cyan
  pnpm run build
  if ($LASTEXITCODE -ne 0) { throw "构建失败，已中止上传" }
}

if (-not (Test-Path $SourceDir)) { throw "找不到产物目录：$SourceDir" }

if (-not (Get-Command coscmd -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 coscmd，正在安装（需要本机有 Python 与 pip）" -ForegroundColor Yellow
  python -m pip install --upgrade coscmd
  if ($LASTEXITCODE -ne 0) { throw "coscmd 安装失败，请手动执行：python -m pip install coscmd" }
}

Write-Host "==> 配置 coscmd（桶 $bucket / 地域 $region）" -ForegroundColor Cyan
coscmd config -a $secretId -s $secretKey -b $bucket -r $region
if ($LASTEXITCODE -ne 0) { throw "coscmd 配置失败，请检查桶名/地域/密钥是否正确" }

# 与 CI 保持一致的缓存策略（顺序同样重要：HTML 最后传，确保 no-cache 生效）
Write-Host "==> 上传 assets（长期强缓存）" -ForegroundColor Cyan
coscmd upload -rs "./$SourceDir/assets/" /assets/ -H '{"Cache-Control":"public, max-age=31536000, immutable"}'
if ($LASTEXITCODE -ne 0) { throw "assets 上传失败，请检查桶名/地域/密钥权限" }

Write-Host "==> 上传 favicon（中等缓存）" -ForegroundColor Cyan
coscmd upload -rs "./$SourceDir/favicon.svg" /favicon.svg -H '{"Cache-Control":"public, max-age=86400"}'
if ($LASTEXITCODE -ne 0) { throw "favicon 上传失败" }

Write-Host "==> 上传 HTML（不缓存）" -ForegroundColor Cyan
coscmd upload -rs "./$SourceDir/" / --include '*.html' -H '{"Cache-Control":"no-cache"}'
if ($LASTEXITCODE -ne 0) { throw "HTML 上传失败，请检查桶名/地域/密钥权限，以及是否开启了公有读" }

if ($SyncDelete) {
  Write-Host "==> 同步删除 COS 上多余的旧文件（需要 cos:DeleteObject 权限）" -ForegroundColor Yellow
  coscmd upload -rs "./$SourceDir/" / --delete -y
  if ($LASTEXITCODE -ne 0) { throw "清理失败：子用户可能缺少 cos:DeleteObject 权限" }
} else {
  Write-Host "==> 未指定 -SyncDelete，跳过旧文件清理" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "上传完成。" -ForegroundColor Green
Write-Host "静态网站访问地址： https://${bucket}.cos-website.${region}.myqcloud.com"
Write-Host "如绑定了自定义域名，请访问自定义域名确认。" -ForegroundColor Gray
