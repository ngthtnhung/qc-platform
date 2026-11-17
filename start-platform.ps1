# =====================================================================
# Internal AI QA Testing Platform - Startup Script
# Starts Backend API & Web Dashboard at http://localhost:3001
# =====================================================================

Set-Location $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "🚀 Khởi động Internal AI QA Testing Platform..." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

$nodePath = "C:\nvm4w\nodejs\node.exe"
if (-not (Test-Path $nodePath)) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) {
        $nodePath = $nodeCmd.Source
    } else {
        Write-Host "❌ Không tìm thấy node.exe trên hệ thống!" -ForegroundColor Red
        exit 1
    }
}

$serverScript = Join-Path $PSScriptRoot "services\api\server.js"

Write-Host "Đang khởi chạy API Server & Dashboard tại: http://localhost:3001" -ForegroundColor Yellow
Write-Host "Nhấn Ctrl+C để dừng server." -ForegroundColor Gray
Write-Host ""

& $nodePath $serverScript
