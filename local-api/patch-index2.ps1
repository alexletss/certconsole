$ErrorActionPreference = "Stop"
$indexPath = "C:\certtracker\web\index.html"

$content = Get-Content $indexPath -Raw -Encoding UTF8

# --- Patch 1: SUPABASE_URL ---
$urlPattern = 'const\s+SUPABASE_URL\s*=\s*["''][^"'']+["''];?'
if ($content -match $urlPattern) {
    $content = [regex]::Replace($content, $urlPattern, 'const SUPABASE_URL = "http://localhost:3000";')
    Write-Host "[OK] SUPABASE_URL replaced" -ForegroundColor Green
} else {
    Write-Host "[WARN] SUPABASE_URL not found" -ForegroundColor Yellow
}

# --- Patch 2: Realtime function (anchored by 'if (realtimeChannel) return;') ---
$anchor = "if (realtimeChannel) return;"
$anchorIdx = $content.IndexOf($anchor)
if ($anchorIdx -lt 0) {
    Write-Host "[ERROR] anchor 'if (realtimeChannel) return;' not found" -ForegroundColor Red
    exit 1
}

# Walk backwards to find 'function' keyword and its opening brace
$searchStart = [Math]::Max(0, $anchorIdx - 200)
$prefix = $content.Substring($searchStart, $anchorIdx - $searchStart)
$funcMatch = [regex]::Match($prefix, 'function\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{|function\s*\([^)]*\)\s*\{', [System.Text.RegularExpressions.RegexOptions]::RightToLeft)
if (-not $funcMatch.Success) {
    Write-Host "[ERROR] could not find 'function ... {' before anchor" -ForegroundColor Red
    exit 1
}
$startIdx = $searchStart + $funcMatch.Index
$braceIdx = $searchStart + $funcMatch.Index + $funcMatch.Length - 1

# Find matching closing brace
$depth = 1
$i = $braceIdx + 1
while ($i -lt $content.Length -and $depth -gt 0) {
    $ch = $content[$i]
    if ($ch -eq '{') { $depth++ }
    elseif ($ch -eq '}') { $depth-- }
    $i++
}
if ($depth -ne 0) {
    Write-Host "[ERROR] could not find closing brace" -ForegroundColor Red
    exit 1
}
$endIdx = $i

$oldFunc = $content.Substring($startIdx, $endIdx - $startIdx)
Write-Host "Found function block: $($oldFunc.Length) chars" -ForegroundColor Cyan

$newFunc = @'
function startRealtime() {
  if (realtimeChannel) return;
  realtimeChannel = true;
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
Write-Host "[OK] realtime function replaced" -ForegroundColor Green

# Also patch the cleanup line (line 1338): replace .close() call - keep as-is, our realtimeChannel = true won't have .close()
# Fix: make cleanup safe
$cleanupPattern = 'if\s*\(\s*realtimeChannel\s*\)\s*\{\s*try\s*\{\s*realtimeChannel\.close\(\)[^}]*\}\s*catch[^}]*\{\s*\}\s*realtimeChannel\s*=\s*null;\s*\}'
$cleanupReplacement = 'if (realtimeChannel) { if (window.__pollTimer) { clearInterval(window.__pollTimer); window.__pollTimer = null; } realtimeChannel = null; }'
if ($content -match $cleanupPattern) {
    $content = [regex]::Replace($content, $cleanupPattern, $cleanupReplacement)
    Write-Host "[OK] cleanup block replaced" -ForegroundColor Green
} else {
    Write-Host "[WARN] cleanup pattern not matched (may be fine)" -ForegroundColor Yellow
}

Set-Content -Path $indexPath -Value $content -Encoding UTF8 -NoNewline
Write-Host "Done." -ForegroundColor Green