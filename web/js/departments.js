/* ============================================================
 Departments module — replaces hardcoded DEPARTMENTS array.
 Loads from DB table 'departments' via /rest/v1/departments.
 Exposes globals: departments[], loadDepartments(), renderDeptList(),
 openDeptModal(id?), closeDeptModal(), saveDeptModal(),
 deleteDeptFromModal(), populateDeptSelect(selectEl, selectedId?),
 translitId(label).
 ============================================================ */

// Color palette (8 swatches) — used in the create/edit modal
const DEPT_PALETTE = [
{ hex: "#6366f1", name: "Индиго" },
{ hex: "#10b981", name: "Зелёный" },
{ hex: "#f59e0b", name: "Янтарь" },
{ hex: "#06b6d4", name: "Голубой" },
{ hex: "#ec4899", name: "Розовый" },
{ hex: "#8b5cf6", name: "Фиолетовый" },
{ hex: "#ef4444", name: "Красный" },
{ hex: "#64748b", name: "Серый" },
];

// Hardcoded fallback used only if DB table is missing/unreachable.
const DEPT_FALLBACK = [
{ id: "admin",     label: "Администрация", icon: "🏛️", color: "#6366f1", sort_order: 10 },
{ id: "doctors",   label: "Врачи",         icon: "🩺", color: "#10b981", sort_order: 20 },
{ id: "reception", label: "Приёмка",       icon: "📥", color: "#f59e0b", sort_order: 30 },
{ id: "kdl",       label: "КДЛ",           icon: "🧪", color: "#06b6d4", sort_order: 40 },
];

// Global departments array (replaces the old hardcoded DEPARTMENTS const).
// Other parts of index.html still reference DEPARTMENTS — we alias it.
let departments = DEPT_FALLBACK.slice();
window.DEPARTMENTS = departments;

const DEPARTMENTS_TABLE = "departments";

// ---------- transliteration (RU -> latin slug) ----------
const TRANSLIT_MAP = {
"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"yo","ж":"zh","з":"z","и":"i",
"й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t",
"у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"",
"э":"e","ю":"yu","я":"ya"
};
function translitId(label) {
if (!label) return "";
let s = String(label).toLowerCase().trim();
let out = "";
for (const ch of s) {
  if (TRANSLIT_MAP[ch] !== undefined) out += TRANSLIT_MAP[ch];
  else if (/[a-z0-9]/.test(ch)) out += ch;
  else if (/\s|-|_/.test(ch)) out += "_";
  // drop everything else
}
out = out.replace(/_+/g, "_").replace(/^_|_$/g, "");
if (!out) out = "dept_" + Date.now().toString(36);
// Ensure uniqueness — if collision, append numeric suffix
let base = out, i = 2;
while (departments.some(d => d.id === out)) {
  out = base + "_" + i;
  i++;
}
return out;
}

// ---------- DB calls ----------
async function deptListDb() {
try { return await sbFetch(`${DEPARTMENTS_TABLE}?select=*&order=sort_order.asc`); }
catch (err) { console.warn("departments table not ready:", err.message); return null; }
}

async function deptInsert(row) {
return await sbFetch(DEPARTMENTS_TABLE, {
  method: "POST",
  body: JSON.stringify(row),
});
}

async function deptUpdate(id, patch) {
return await sbFetch(`${DEPARTMENTS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
  method: "PATCH",
  body: JSON.stringify(patch),
});
}

async function deptDelete(id) {
return await sbFetch(`${DEPARTMENTS_TABLE}?id=eq.${encodeURIComponent(id)}`, {
  method: "DELETE",
});
}

// ---------- Loader (called at startup + on realtime change) ----------
async function loadDepartments() {
const rows = await deptListDb();
if (rows === null) {
  // table missing — keep fallback, log it
  departments = DEPT_FALLBACK.slice();
} else if (rows.length === 0 && currentUser && currentUser.role === "admin") {
  // empty table + admin user — seed it
  for (const def of DEPT_FALLBACK) {
    try { await deptInsert(def); } catch (e) {}
  }
  departments = (await deptListDb()) || DEPT_FALLBACK.slice();
} else if (rows.length === 0) {
  departments = DEPT_FALLBACK.slice();
} else {
  departments = rows;
}
// Add a 'soft' field at runtime — computed from color hex with 14% alpha.
// Used by renderSidebar/renderTabs/applyDeptColors which expect d.color + d.soft.
for (const d of departments) {
  d.soft = hexToSoft(d.color);
}
window.DEPARTMENTS = departments;

// Refresh anything that depends on dept list
if (typeof renderSidebar === "function") renderSidebar();
if (typeof renderTabs === "function") renderTabs();
populateDeptSelect(document.getElementById("formDept"));
// If admin modal is open on the depts tab, re-render the list
const adminModal = document.getElementById("adminModal");
if (adminModal && !adminModal.classList.contains("hidden")) {
  const v = document.getElementById("adminDeptsView");
  if (v && !v.classList.contains("hidden")) renderDeptList();
}
// Validate currentDept still exists; if not, fall back to first
if (typeof currentDept !== "undefined" && !departments.some(d => d.id === currentDept)) {
  if (departments.length) {
    currentDept = departments[0].id;
    localStorage.setItem(DEPT_KEY, currentDept);
    if (typeof applyDeptColors === "function") applyDeptColors();
    if (typeof render === "function") render();
  }
}
}

function hexToSoft(hex) {
// #rrggbb -> rgba(r,g,b,0.14)
const m = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(hex || "");
if (!m) return "rgba(99,102,241,0.14)";
const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
return `rgba(${r},${g},${b},0.14)`;
}

// ---------- Populate <select id="formDept"> dynamically ----------
function populateDeptSelect(selectEl, selectedId) {
if (!selectEl) return;
const cur = selectedId || selectEl.value;
selectEl.innerHTML = departments.map(d =>
  `<option value="${escapeAttr(d.id)}">${escapeHtml(d.label)}</option>`
).join("");
if (cur && departments.some(d => d.id === cur)) selectEl.value = cur;
}

// ---------- Render dept list inside admin modal ----------
function renderDeptList() {
const wrap = document.getElementById("deptList");
if (!wrap) return;
if (!departments.length) {
  wrap.innerHTML = `<div class="empty"><div class="empty-icon">🏢</div>Отделов пока нет.</div>`;
  return;
}
// Count employees per dept (for the "X сотрудников" badge)
const counts = {};
if (typeof data !== "undefined" && Array.isArray(data)) {
  for (const p of data) {
    const k = p.dept || "admin";
    counts[k] = (counts[k] || 0) + 1;
  }
}
wrap.innerHTML = departments.map(d => {
  const cnt = counts[d.id] || 0;
  return `<div class="purpose-card" onclick="openDeptModal('${escapeAttr(d.id)}')" style="border-left:4px solid ${escapeAttr(d.color)}">
    <div class="purpose-card-head">
      <div style="flex:1;min-width:0">
        <div class="purpose-card-title">${escapeHtml(d.icon || "🏢")} ${escapeHtml(d.label)}</div>
        <div class="purpose-card-desc" style="font-family:monospace;font-size:11px;color:var(--text-faint)">${escapeHtml(d.id)}</div>
        <div class="purpose-card-meta">
          <span>👥 ${cnt} сотр.</span>
          <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:12px;border-radius:3px;background:${escapeAttr(d.color)};display:inline-block"></span>${escapeHtml(d.color)}</span>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openDeptModal('${escapeAttr(d.id)}')">✏️</button>
    </div>
  </div>`;
}).join("");
}

// ---------- Dept modal (create/edit) ----------
let _deptModalEditingId = null;
let _deptModalSelectedColor = DEPT_PALETTE[0].hex;

function openDeptModal(id) {
_deptModalEditingId = id || null;
const titleEl = document.getElementById("deptModalTitle");
const labelInput = document.getElementById("deptModalLabel");
const iconInput = document.getElementById("deptModalIcon");
const delBtn = document.getElementById("deptModalDelete");

if (id) {
  const d = departments.find(x => x.id === id);
  if (!d) return;
  titleEl.textContent = "Редактирование отдела";
  labelInput.value = d.label || "";
  iconInput.value = d.icon || "🏢";
  _deptModalSelectedColor = d.color || DEPT_PALETTE[0].hex;
  delBtn.style.display = "";
} else {
  titleEl.textContent = "Новый отдел";
  labelInput.value = "";
  iconInput.value = "🏢";
  _deptModalSelectedColor = DEPT_PALETTE[0].hex;
  delBtn.style.display = "none";
}
renderColorPalette();
document.getElementById("deptModal").classList.remove("hidden");
labelInput.focus();
}

function closeDeptModal() {
document.getElementById("deptModal").classList.add("hidden");
_deptModalEditingId = null;
}

function renderColorPalette() {
const wrap = document.getElementById("deptModalPalette");
if (!wrap) return;
wrap.innerHTML = DEPT_PALETTE.map(p => {
  const active = (p.hex.toLowerCase() === (_deptModalSelectedColor || "").toLowerCase());
  return `<button type="button" title="${escapeAttr(p.name)}" onclick="selectDeptColor('${escapeAttr(p.hex)}')" style="width:32px;height:32px;border-radius:8px;background:${escapeAttr(p.hex)};border:${active ? '3px solid var(--text)' : '2px solid var(--border-glass)'};cursor:pointer;padding:0;transition:transform 0.1s" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'"></button>`;
}).join("");
}

function selectDeptColor(hex) {
_deptModalSelectedColor = hex;
renderColorPalette();
}

async function saveDeptModal() {
const label = document.getElementById("deptModalLabel").value.trim();
const icon = document.getElementById("deptModalIcon").value.trim() || "🏢";
const color = _deptModalSelectedColor || "#6366f1";
if (!label) return alert("Введите название отдела");

try {
  if (_deptModalEditingId) {
    // Update — keep id, allow label/icon/color change
    await deptUpdate(_deptModalEditingId, { label, icon, color });
  } else {
    // Create — generate translit id, append at end of sort_order
    const id = translitId(label);
    const maxSort = departments.reduce((m, d) => Math.max(m, d.sort_order || 0), 0);
    await deptInsert({ id, label, icon, color, sort_order: maxSort + 10 });
  }
  closeDeptModal();
  await loadDepartments();
} catch (err) {
  alert("Ошибка сохранения: " + err.message);
}
}

async function deleteDeptFromModal() {
const id = _deptModalEditingId;
if (!id) return;
const d = departments.find(x => x.id === id);
if (!d) return;

// Count employees in this dept
const affected = (typeof data !== "undefined" && Array.isArray(data))
  ? data.filter(p => (p.dept || "admin") === id)
  : [];

if (departments.length <= 1) {
  return alert("Нельзя удалить последний отдел. Создайте хотя бы один другой.");
}

// If employees exist, ask where to move them
let targetId = null;
if (affected.length > 0) {
  const others = departments.filter(x => x.id !== id);
  const options = others.map(x => `${x.icon} ${x.label} (${x.id})`).join("
");
  const prompt1 = `В отделе "${d.label}" находится ${affected.length} сотр.

Куда перенести их перед удалением?

Введите ID нового отдела:
${others.map(x => `  • ${x.id} — ${x.label}`).join("
")}`;
  targetId = window.prompt(prompt1, others[0].id);
  if (!targetId) return;
  targetId = targetId.trim();
  if (!departments.some(x => x.id === targetId)) {
    return alert(`Отдел "${targetId}" не найден. Удаление отменено.`);
  }
} else {
  if (!confirm(`Удалить отдел "${d.label}"?`)) return;
}

try {
  // 1) Reassign employees if needed
  if (affected.length > 0 && targetId) {
    for (const p of affected) {
      await sbFetch(`certificates?id=eq.${encodeURIComponent(p.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ dept: targetId }),
      });
    }
    // Refresh the global `data` array
    if (typeof refreshData === "function") await refreshData();
  }
  // 2) Delete the dept row
  await deptDelete(id);
  closeDeptModal();
  await loadDepartments();
  // 3) If user was viewing the deleted dept, switch to first
  if (typeof currentDept !== "undefined" && currentDept === id) {
    currentDept = departments[0].id;
    localStorage.setItem(DEPT_KEY, currentDept);
    if (typeof applyDeptColors === "function") applyDeptColors();
    if (typeof render === "function") render();
  }
} catch (err) {
  alert("Ошибка удаления: " + err.message);
}
}

// ---------- Wire up admin-modal third tab "Отделы" ----------
// This patches the existing setAdminTab so it handles the new 'depts' value.
// Called at the bottom of this file after the original is defined.
(function wireAdminDeptTab() {
const origSetAdminTab = window.setAdminTab;
window.setAdminTab = function(t) {
  // Toggle all three tab buttons
  const btnUsers = document.getElementById("adminTabUsers");
  const btnPurposes = document.getElementById("adminTabPurposes");
  const btnDepts = document.getElementById("adminTabDepts");
  const vUsers = document.getElementById("adminUsersView");
  const vPurposes = document.getElementById("adminPurposesView");
  const vDepts = document.getElementById("adminDeptsView");
  if (btnUsers) btnUsers.classList.toggle("active", t === "users");
  if (btnPurposes) btnPurposes.classList.toggle("active", t === "purposes");
  if (btnDepts) btnDepts.classList.toggle("active", t === "depts");
  if (vUsers) vUsers.classList.toggle("hidden", t !== "users");
  if (vPurposes) vPurposes.classList.toggle("hidden", t !== "purposes");
  if (vDepts) vDepts.classList.toggle("hidden", t !== "depts");
  if (t === "users" && typeof renderUserList === "function") renderUserList();
  else if (t === "purposes" && typeof renderPurposeList === "function") renderPurposeList();
  else if (t === "depts") renderDeptList();
};
})();

// ---------- Hook into realtime polling ----------
// startRealtime polls /changes — when 'departments' table changes, reload.
(function hookRealtime() {
// We don't override startRealtime here — instead, server.py's /changes
// already returns 'departments' in the changed[] list. We just need to
// make sure the polling tick calls loadDepartments. We patch the tick
// by overriding the existing startRealtime AFTER it's set up.
// Simplest approach: schedule a separate slow poll for departments.
// But better: monkey-patch fetch is overkill — just add a one-time hook.
// Implementation: we'll wrap window.startRealtime once init runs.
const origStart = window.startRealtime;
if (typeof origStart !== "function") return; // will retry below
window.startRealtime = function() {
  if (window.realtimeChannel) return;
  window.realtimeChannel = true;
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
          else if (t === DEPARTMENTS_TABLE) await loadDepartments();
        }
      }
    } catch (e) {}
  }
  window.__pollTimer = setInterval(tick, 3000);
  tick();
};
})();

// Expose to global scope
window.loadDepartments = loadDepartments;
window.renderDeptList = renderDeptList;
window.openDeptModal = openDeptModal;
window.closeDeptModal = closeDeptModal;
window.saveDeptModal = saveDeptModal;
window.deleteDeptFromModal = deleteDeptFromModal;
window.selectDeptColor = selectDeptColor;
window.populateDeptSelect = populateDeptSelect;
window.translitId = translitId;
window.DEPT_PALETTE = DEPT_PALETTE;
