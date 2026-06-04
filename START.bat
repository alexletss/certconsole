@echo off
chcp 65001 >nul
title CertTracker Server

netstat -an | findstr ":5432" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo Starting PostgreSQL...
    "C:\certtracker\pgsql\bin\pg_ctl.exe" -D "C:\certtracker\data" -l "C:\certtracker\logfile.txt" start
    timeout /t 3 >nul
) else (
    echo PostgreSQL already running
)

cd /d C:\certtracker\local-api
echo Starting API...
powershell -ExecutionPolicy Bypass -File "C:\certtracker\local-api\start.ps1"

echo.
echo === SERVER STOPPED ===
pause