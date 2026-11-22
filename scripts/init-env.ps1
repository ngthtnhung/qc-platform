<#
.SYNOPSIS
  Tạo/kiểm tra file .env cho docker compose với giá trị ngẫu nhiên hợp lệ.
.DESCRIPTION
  - Chưa có .env: sao chép từ .env.example.
  - Điền các giá trị còn TRỐNG (POSTGRES_*, JWT_SIGNING_KEY, SECRET_KEK, POSTGRES_PORT nếu 5432 không dùng được).
  - KHÔNG BAO GIỜ ghi đè giá trị đã có. Nếu SECRET_KEK đã có nhưng không hợp lệ: báo lỗi và dừng (đổi KEK khi vault đã có dữ liệu
    sẽ làm mất mật khẩu đã lưu, nên script không tự thay).
  - Không in giá trị bí mật ra màn hình.
.EXAMPLE
  .\scripts\init-env.ps1
#>
param([string]$Path = (Join-Path $PSScriptRoot '..\.env'), [string]$Example = (Join-Path $PSScriptRoot '..\.env.example'))
$ErrorActionPreference = 'Stop'

function New-RandomBytes([int]$n) { $b = New-Object byte[] $n; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $b }
function New-UrlSafe([int]$n) { ([Convert]::ToBase64String((New-RandomBytes $n))).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function Test-Kek([string]$v) {
    try { $raw = [Convert]::FromBase64String($v); return ($raw.Length -eq 32) } catch { return $false }
}
function Test-PortFree([int]$p) {
    try { $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p); $l.Start(); $l.Stop(); $true } catch { $false }
}

if (-not (Test-Path $Path)) {
    if (-not (Test-Path $Example)) { throw "Không tìm thấy $Example" }
    Copy-Item $Example $Path
    Write-Host "Đã tạo $Path từ .env.example"
}

$lines = [System.Collections.Generic.List[string]](Get-Content -Path $Path -Encoding UTF8)
function Get-Val([string]$k) {
    foreach ($l in $lines) { if ($l -match "^\s*$k\s*=\s*(.*?)\s*(#.*)?$") { return $Matches[1].Trim('"').Trim("'") } }
    return $null
}
function Set-Val([string]$k, [string]$v) {
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^\s*$k\s*=") { $lines[$i] = "$k=$v"; return } }
    $lines.Add("$k=$v")
}

$changed = @()
foreach ($k in 'POSTGRES_DB', 'POSTGRES_USER') {
    if (-not (Get-Val $k)) { Set-Val $k 'qc'; $changed += $k }
}
if (-not (Get-Val 'POSTGRES_PASSWORD')) { Set-Val 'POSTGRES_PASSWORD' (New-UrlSafe 24); $changed += 'POSTGRES_PASSWORD' }
if (-not (Get-Val 'JWT_SIGNING_KEY')) { Set-Val 'JWT_SIGNING_KEY' (New-UrlSafe 48); $changed += 'JWT_SIGNING_KEY' }

$kek = Get-Val 'SECRET_KEK'
if (-not $kek) {
    Set-Val 'SECRET_KEK' ([Convert]::ToBase64String((New-RandomBytes 32))); $changed += 'SECRET_KEK'
    Write-Warning 'Đã tạo SECRET_KEK mới. SAO LƯU giá trị này ngoài máy: mất khóa = mất mọi mật khẩu trong vault.'
} elseif (-not (Test-Kek $kek)) {
    Write-Error ("SECRET_KEK trong $Path không hợp lệ (cần base64 của đúng 32 byte; có thể còn ký tự thừa, dấu ngoặc hoặc chưa phải giá trị sinh ngẫu nhiên). " +
        "Nếu CHƯA lưu mật khẩu nào vào vault: xóa giá trị sau 'SECRET_KEK=' rồi chạy lại script để tạo mới. " +
        "Nếu đã lưu mật khẩu: phải khôi phục đúng khóa cũ, đừng tạo khóa mới.")
}

if (-not (Get-Val 'POSTGRES_PORT') -and -not (Test-PortFree 5432)) {
    Set-Val 'POSTGRES_PORT' '55432'; $changed += 'POSTGRES_PORT'
    Write-Host 'Cổng 5432 không dùng được trên máy này (đã bị chiếm hoặc nằm trong dải Windows loại trừ): dùng 55432.'
}

# Ghi UTF-8 KHÔNG BOM: BOM đầu file làm hỏng tên khóa đầu tiên khi docker compose đọc .env
[System.IO.File]::WriteAllLines((Resolve-Path -LiteralPath $Path).Path, $lines, (New-Object System.Text.UTF8Encoding($false)))
if ($changed.Count) { Write-Host ("Đã điền: " + ($changed -join ', ')) } else { Write-Host 'Không có gì cần điền; .env đã đầy đủ.' }
Write-Host 'Kiểm tra: SECRET_KEK hợp lệ.'
