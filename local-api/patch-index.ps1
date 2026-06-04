$ErrorActionPreference = "Stop"
$indexPath = "C:\certtracker\web\index.html"
$backupPath = "C:\certtracker\web\index.html.bak"

if (-not (Test-Path $indexPath)) {
    Write-Host "ERROR: $indexPath not found" -ForegroundColor Red
    exit 1
}

# Backup
Copy-Item $indexPath $backupPath -Force
Write-Host "Backup created: $backupPath" -ForegroundColor Green

$content = Get-Content $indexPath -Raw -Encoding UTF8

# --- Patch 1: SUPABASE_URL ---
$urlPattern = 'const\s+SUPABASE_URL\s*=\s*["''][^"'']+["''];?'
if ($content -match $urlPattern) {
    $content = [regex]::Replace($content, $urlPattern, 'const SUPABASE_URL = "http://localhost:3000";')
    Write-Host "[OK] SUPABASE_URL replaced" -ForegroundColor Green
} else {
    Write-Host "[WARN] SUPABASE_URL pattern not found" -ForegroundColor Yellow
}

# --- Patch 2: startRealtime function ---
# Find "function startRealtime() {" and match braces until closing
$startMarker = "function startRealtime()"
$startIdx = $content.IndexOf($startMarker)
if ($startIdx -lt 0) {
    Write-Host "[ERROR] startRealtime() not found" -ForegroundColor Red
    exit 1
}

# Find opening brace
$braceIdx = $content.IndexOf("{", $startIdx)
$depth = 1
$i = $braceIdx + 1
while ($i -lt $content.Length -and $depth -gt 0) {
    $ch = $content[$i]
    if ($ch -eq '{') { $depth++ }
    elseif ($ch -eq '}') { $depth-- }
    $i++
}
if ($depth -ne 0) {
    Write-Host "[ERROR] Could not find closing brace of startRealtime" -ForegroundColor Red
    exit 1
}

$endIdx = $i  # position after closing }
$oldFunc = $content.Substring($startIdx, $endIdx - $startIdx)

$newFunc = @'
function startRealtime() {
  if (window.__pollTimer) return;
  window.__changeSeq = window.__changeSeq || {};
  async function tick() {
    try {
      const res = await fetch(SUPABASE_URL + "/changes?since=" + encodeURIComponent(JSON.stringify(window.__changeSeq)));
      if (res.ok) {
        const j = await res.json();
        window.__changeSeq = j.seq || {};
        for (const t of (j.changed || [])) {
          if (t === TABLE) await refreshData();
          else if (t === PURPOSES_TABLE) await loadPurposes();
          else if (t === USERS_TABLE) await loadUsers();
          else if (t === AUDIT_TABLE) await loadAudit();
        }
      }
    } catch (e) {}
  }
  window.__pollTimer = setInterval(tick, 3000);
  tick();
}
'@

$content = $content.Substring(0, $startIdx) + $newFunc + $content.Substring($endIdx)
Write-Host "[OK] startRealtime() replaced" -ForegroundColor Green

# Save
Set-Content -Path $indexPath -Value $content -Encoding UTF8 -NoNewline
Write-Host "Done. File saved: $indexPath" -ForegroundColor Green
Write-Host "Backup at: $backupPath" -ForegroundColor Cyan