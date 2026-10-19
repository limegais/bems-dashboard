@echo off
title BEMS Dashboard Runner
echo ======================================================
echo   Memulai BEMS Dashboard (Web Server + MQTT Bridge)
echo ======================================================

cd /d "%~dp0"

echo [1/2] Menjalankan MQTT Bridge di jendela terpisah...
start "MQTT Bridge (bridge.py)" python bridge.py

echo Buka di browser lokal: http://localhost:3000
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias ''*Wi-Fi*'' -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress"') do set "WIFI_IP=%%i"
if defined WIFI_IP (
    echo Untuk orang lain di Wi-Fi yang sama: http://%WIFI_IP%:3000
)
echo.
npx serve -l 3000 .
