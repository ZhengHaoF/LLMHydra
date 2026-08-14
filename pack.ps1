# ============================================================
# LLMHydra 打包脚本
# 将项目打包为 zip，输出到项目根目录：
#   llm-hydra-v<版本>-<时间戳>.zip
# zip 内为项目文件直出（client/ server/ package.json ...），
# 无 ./ 空根目录，也无顶层文件夹。
#
# 默认排除：
#   - node_modules            （依赖目录，根目录 + 各子包）
#   - stats.db / -shm / -wal  （SQLite 统计数据库）
#   - proxy_config.json       （运行时配置，含 API Key 与代理密钥）
#   - .git / .idea / .workbuddy / .pnpm-store / *.log / .DS_Store / Thumbs.db
#   - 历史打包结果 *.zip / *.tgz
#
# 使用方法：
#   pnpm run pack:zip   （推荐）
#   或直接：powershell -NoProfile -ExecutionPolicy Bypass -File .\pack.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 版本号取自根 package.json
$pkg = Get-Content -Raw -Path (Join-Path $root 'package.json') | ConvertFrom-Json
$version = $pkg.version

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$zipName = "llm-hydra-v$version-$stamp.zip"
$zipPath = Join-Path $root $zipName

# 顶层条目黑名单（直接不打包）
$skipNames = @(
    'node_modules',
    'stats.db', 'stats.db-shm', 'stats.db-wal',
    'proxy_config.json',
    '.git', '.idea', '.workbuddy', '.pnpm-store'
)

# 递归打包时额外排除的嵌套条目（bsdtar --exclude 模式，* 可跨层级匹配）
$nestedExcludes = @(
    '*/node_modules',   # client/ server/ 内的依赖
    '*.log',
    '*/.DS_Store',
    '*/Thumbs.db'
)

# 显式枚举顶层条目：跳过黑名单与历史打包产物
$items = Get-ChildItem -Force $root |
    Where-Object { $skipNames -notcontains $_.Name -and $_.Name -notlike '*.zip' -and $_.Name -notlike '*.tgz' } |
    Sort-Object Name |
    ForEach-Object { $_.Name }

$excludeArgs = $nestedExcludes | ForEach-Object { "--exclude=$_" }

Write-Host "正在打包 -> $zipName ..."
# 显式传入顶层条目，条目直出 zip 根目录：无 ./ 前缀、无顶层文件夹
tar -a -c -f $zipPath @excludeArgs -C $root @items
if ($LASTEXITCODE -ne 0) {
    throw "tar 打包失败 (exit code $LASTEXITCODE)"
}

$size = (Get-Item $zipPath).Length
$count = (tar -tf $zipPath | Where-Object { $_ -notmatch '/$' }).Count

Write-Host "打包完成: $zipName"
Write-Host ("大小: {0:N2} MB, 文件数: {1}" -f ($size / 1MB), $count)
