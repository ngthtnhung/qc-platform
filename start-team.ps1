# =====================================================================
# Khởi động server cho cả nhóm (mạng LAN, HTTPS). Chạy: .\start-team.ps1
# - Nghe trên mọi địa chỉ mạng của máy này, cổng 3001
# - Dùng chứng chỉ trong secrets\tls.crt và tls.key (phải có địa chỉ IP của máy này trong chứng chỉ)
# - Khóa AI (tùy chọn): đặt GEMINI_API_KEY trước khi chạy
# =====================================================================
Set-Location $PSScriptRoot

$env:HOST = "0.0.0.0"
$env:PORT = "3001"
$env:TLS_CERT = Join-Path $PSScriptRoot "secrets\tls.crt"
$env:TLS_KEY = Join-Path $PSScriptRoot "secrets\tls.key"

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -ExpandProperty IPAddress
Write-Host "Server cho nhóm. Thành viên mở: " -ForegroundColor Green -NoNewline
Write-Host (($ips | ForEach-Object { "https://${_}:3001" }) -join "  hoặc  ") -ForegroundColor Yellow
Write-Host "AI phân tích bug: $(if ($env:GEMINI_API_KEY -or $env:ANTHROPIC_API_KEY) { 'có khóa' } else { 'chưa có khóa (phân tích theo dữ liệu)' })"
Write-Host "Nhấn Ctrl+C để dừng." -ForegroundColor Gray

$node = "C:\nvm4w\nodejs\node.exe"
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
& $node (Join-Path $PSScriptRoot "services\api\server.js")
