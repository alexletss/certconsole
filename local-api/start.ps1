$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PG_DSN     = "postgresql://authenticator:authpass2026@127.0.0.1:5432/certtracker"
$env:CERT_FILES = "C:\certtracker\files"
$env:CERT_WEB   = "C:\certtracker\web"
$env:PORT       = "3000"
$env:PYTHONUNBUFFERED = "1"

Set-Location $here
Write-Host "Starting cert-tracker API on http://localhost:3000 ..." -ForegroundColor Green
& "$here\venv\Scripts\python.exe" run.py