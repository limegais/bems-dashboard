param (
    [int]$Port = 3000
)

$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $PSScriptRoot

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Memulai BEMS Dashboard (Web Server + MQTT Bridge)   " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# 1. Jalankan MQTT Bridge di background job
Write-Host "[1/2] Menjalankan MQTT Bridge (bridge.py)..." -ForegroundColor Yellow
$bridgeJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    python bridge.py
} -ArgumentList $PSScriptRoot

# Beri waktu sejenak untuk start
Start-Sleep -Seconds 1

# 2. Jalankan npx serve
$wifiIP = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress -First 1)
if (-not $wifiIP) {
    $wifiIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -ExpandProperty IPAddress -First 1)
}

Write-Host "[2/2] Menjalankan Web Server di port $Port..." -ForegroundColor Green
Write-Host "  > Local:   http://localhost:$Port" -ForegroundColor Cyan
if ($wifiIP) {
    Write-Host "  > Network: http://$wifiIP`:$Port  (untuk perangkat lain di Wi-Fi yang sama)" -ForegroundColor Cyan
}
Write-Host "Tekan CTRL + C untuk menghentikan semua service." -ForegroundColor Gray
Write-Host ""

try {
    npx serve -l $Port .
}
finally {
    Write-Host "`nMenghentikan MQTT Bridge..." -ForegroundColor Yellow
    Stop-Job $bridgeJob -ErrorAction SilentlyContinue
    Remove-Job $bridgeJob -ErrorAction SilentlyContinue
    Write-Host "Selesai. Semua service telah ditutup." -ForegroundColor Green
}
