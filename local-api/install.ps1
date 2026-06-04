# Run once. Creates venv in C:\certtracker\local-api\venv and installs deps.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path "$here\venv")) {
  Write-Host "Creating venv..." -ForegroundColor Cyan
  python -m venv venv
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
& "$here\venv\Scripts\python.exe" -m pip install --upgrade pip
& "$here\venv\Scripts\python.exe" -m pip install -r requirements.txt

Write-Host "Done. Run start.ps1 to launch the server." -ForegroundColor Green