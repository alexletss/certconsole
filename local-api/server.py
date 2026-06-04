import asyncio, sys
if sys.platform == "win32":
asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
"""
Cert-Tracker local API server.
Replaces Supabase PostgREST + Storage + Realtime with one FastAPI process.
- /rest/v1/<table>             — Supabase-compatible REST (eq, order, limit, select, Prefer)
- /storage/v1/object/...       — file upload/download into C:\\\\certtracker\\\\files\\\\
- /changes?since=<iso>         — long-polling realtime replacement
- /                            — serves index.html
"""
import os
import log_filter, json, re, hashlib, mimetypes
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, Request, Response, HTTPException, UploadFile
from fastapi.responses import JSONResponse, FileResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware

# ---------- config ----------
PG_DSN     = os.environ.get("PG_DSN", "postgresql://postgres:postgres@127.0.0.1:5432/certtracker")
FILES_ROOT = Path(os.environ.get("CERT_FILES", r"C:\certtracker\files"))
WEB_ROOT   = Path(os.environ.get("CERT_WEB", r"C:\certtracker"))     # where index.html lives
PORT       = int(os.environ.get("PORT", "3000"))
ALLOWED_TABLES = {"certificates", "users", "audit_log", "purposes", "files", "departments"}

FILES_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="cert-tracker local API")
app.add_middleware(
CORSMiddleware,
allow_origins=["*"],
allow_methods=["*"],
allow_headers=["*"],
expose_headers=["*"],
)

# ---------- DB pool ----------
from psycopg_pool import ConnectionPool
_pool = ConnectionPool(PG_DSN, min_size=1, max_size=10, kwargs={'autocommit': True, 'row_factory': dict_row}, open=True)

class _CurAdapter:
def __init__(self, cur, ca=None):
    self._cur = cur; self._ca = ca
async def __aenter__(self): return self
async def __aexit__(self, *a):
    self._cur.close()
    if self._ca: self._ca._release()
async def execute(self, *a, **kw): return await asyncio.to_thread(self._cur.execute, *a, **kw)
async def fetchall(self): return await asyncio.to_thread(self._cur.fetchall)
async def fetchone(self): return await asyncio.to_thread(self._cur.fetchone)
@property
def rowcount(self): return self._cur.rowcount
@property
def description(self): return self._cur.description

class _ConnAdapter:
def __init__(self, conn): self._conn = conn
def cursor(self): return _CurAdapter(self._conn.cursor(), self)
async def commit(self): await asyncio.to_thread(self._conn.commit)
async def rollback(self): await asyncio.to_thread(self._conn.rollback)
def _release(self):
    try: _pool.putconn(self._conn)
    except Exception: pass

async def db():
conn = await asyncio.to_thread(_pool.getconn)
return _ConnAdapter(conn)

# ---------- Supabase-style query parser ----------
OP_MAP = {
"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=",
"like": "LIKE", "ilike": "ILIKE", "is": "IS",
}
def parse_filters(qs: dict[str, list[str]]):
where, params = [], []
for key, values in qs.items():
    if key in ("select", "order", "limit", "offset"):
        continue
    for v in values:
        m = re.match(r"^(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(.*)$", v, re.DOTALL)
        if not m:
            continue
        op, val = m.group(1), m.group(2)
        if op == "is":
            if val.lower() == "null":
                where.append(f'"{key}" IS NULL')
            else:
                where.append(f'"{key}" IS NOT NULL')
        else:
            where.append(f'"{key}" {OP_MAP[op]} %s')
            params.append(val)
return (" WHERE " + " AND ".join(where)) if where else "", params

def parse_order(qs: dict[str, list[str]]):
out = []
for v in qs.get("order", []):
    for part in v.split(","):
        part = part.strip()
        if not part: continue
        if "." in part:
            col, direction = part.split(".", 1)
            direction = "DESC" if direction.lower().startswith("desc") else "ASC"
        else:
            col, direction = part, "ASC"
        if re.match(r"^[A-Za-z0-9_]+$", col):
            out.append(f'"{col}" {direction}')
return (" ORDER BY " + ", ".join(out)) if out else ""

def parse_limit(qs: dict[str, list[str]]):
lim = qs.get("limit", [None])[0]
off = qs.get("offset", [None])[0]
sql = ""
if lim and lim.isdigit(): sql += f" LIMIT {int(lim)}"
if off and off.isdigit(): sql += f" OFFSET {int(off)}"
return sql

def qs_to_dict(request: Request) -> dict[str, list[str]]:
out: dict[str, list[str]] = {}
for k, v in request.query_params.multi_items():
    out.setdefault(k, []).append(v)
return out

def check_table(t: str):
if t not in ALLOWED_TABLES:
    raise HTTPException(404, f"unknown table {t}")

def jsonable(o: Any):
if isinstance(o, datetime): return o.isoformat()
return str(o)

# ---------- REST /rest/v1/<table> ----------
@app.get("/rest/v1/{table}")
async def rest_get(table: str, request: Request):
check_table(table)
qs = qs_to_dict(request)
where, params = parse_filters(qs)
order = parse_order(qs)
limit = parse_limit(qs)
select_cols = qs.get("select", ["*"])[0]
if select_cols != "*":
    cols = ",".join(f'"{c.strip()}"' for c in select_cols.split(",") if re.match(r"^[A-Za-z0-9_]+$", c.strip()))
    cols = cols or "*"
else:
    cols = "*"
sql = f'SELECT {cols} FROM public."{table}"{where}{order}{limit}'
async with (await db()).cursor() as cur:
    await cur.execute(sql, params)
    rows = await cur.fetchall()
return JSONResponse(json.loads(json.dumps(rows, default=jsonable)))

@app.post("/rest/v1/{table}")
async def rest_post(table: str, request: Request):
check_table(table)
body = await request.json()
rows = body if isinstance(body, list) else [body]
if not rows:
    return JSONResponse([])
prefer = request.headers.get("prefer", "")
return_repr = "return=representation" in prefer
merge = "resolution=merge-duplicates" in prefer

inserted = []
async with (await db()).cursor() as cur:
    for row in rows:
        cols = list(row.keys())
        placeholders = ",".join(["%s"] * len(cols))
        col_sql = ",".join(f'"{c}"' for c in cols)
        values = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in row.values()]
        if merge:
            # upsert on primary key (id)
            update_sql = ",".join(f'"{c}"=EXCLUDED."{c}"' for c in cols if c != "id")
            sql = (f'INSERT INTO public."{table}" ({col_sql}) VALUES ({placeholders}) '
                   f'ON CONFLICT (id) DO UPDATE SET {update_sql or "id=EXCLUDED.id"} RETURNING *')
        else:
            sql = f'INSERT INTO public."{table}" ({col_sql}) VALUES ({placeholders}) RETURNING *'
        await cur.execute(sql, values)
        r = await cur.fetchone()
        inserted.append(r)
await bump_change(table)
if return_repr:
    return JSONResponse(json.loads(json.dumps(inserted, default=jsonable)))
return Response(status_code=201)

@app.patch("/rest/v1/{table}")
async def rest_patch(table: str, request: Request):
check_table(table)
body = await request.json()
qs = qs_to_dict(request)
where, params = parse_filters(qs)
if not where:
    raise HTTPException(400, "PATCH requires a filter")
set_parts, set_vals = [], []
for k, v in body.items():
    set_parts.append(f'"{k}" = %s')
    set_vals.append(json.dumps(v) if isinstance(v, (dict, list)) else v)
sql = f'UPDATE public."{table}" SET {", ".join(set_parts)}{where} RETURNING *'
async with (await db()).cursor() as cur:
    await cur.execute(sql, set_vals + params)
    rows = await cur.fetchall()
await bump_change(table)
return JSONResponse(json.loads(json.dumps(rows, default=jsonable)))

@app.delete("/rest/v1/{table}")
async def rest_delete(table: str, request: Request):
check_table(table)
qs = qs_to_dict(request)
where, params = parse_filters(qs)
if not where:
    raise HTTPException(400, "DELETE requires a filter")
sql = f'DELETE FROM public."{table}"{where} RETURNING *'
async with (await db()).cursor() as cur:
    await cur.execute(sql, params)
    rows = await cur.fetchall()
await bump_change(table)
return JSONResponse(json.loads(json.dumps(rows, default=jsonable)))

# ---------- Storage ----------
def safe_join(root: Path, *parts: str) -> Path:
p = (root / Path(*[unquote(x) for x in parts])).resolve()
if not str(p).startswith(str(root.resolve())):
    raise HTTPException(400, "bad path")
return p

@app.post("/storage/v1/object/{bucket}/{path:path}")
async def storage_upload(bucket: str, path: str, request: Request):
target = safe_join(FILES_ROOT / bucket, path)
target.parent.mkdir(parents=True, exist_ok=True)
body = await request.body()
target.write_bytes(body)
return JSONResponse({"Key": f"{bucket}/{path}"})

@app.delete("/storage/v1/object/{bucket}/{path:path}")
async def storage_delete(bucket: str, path: str):
target = safe_join(FILES_ROOT / bucket, path)
if target.exists():
    target.unlink()
return Response(status_code=200)

@app.get("/storage/v1/object/public/{bucket}/{path:path}")
async def storage_public(bucket: str, path: str):
target = safe_join(FILES_ROOT / bucket, path)
if not target.exists():
    raise HTTPException(404, "not found")
mime, _ = mimetypes.guess_type(str(target))
return FileResponse(target, media_type=mime or "application/octet-stream")

@app.get("/storage/v1/object/{bucket}/{path:path}")
async def storage_get(bucket: str, path: str):
return await storage_public(bucket, path)

# ---------- Long-polling realtime ----------
# We bump a per-table counter on every mutation. /changes?since=<json> returns
# which tables changed since the client's snapshot.
_change_seq: dict[str, int] = {t: 0 for t in ALLOWED_TABLES}

async def bump_change(table: str):
_change_seq[table] = _change_seq.get(table, 0) + 1

@app.get("/changes")
async def changes(request: Request):
since_raw = request.query_params.get("since", "{}")
try:
    since = json.loads(since_raw)
except Exception:
    since = {}
changed = [t for t, n in _change_seq.items() if n > int(since.get(t, 0))]
return JSONResponse({"changed": changed, "seq": _change_seq})

# ---------- Static (index.html) ----------
@app.get("/")
async def root():
f = WEB_ROOT / "index.html"
if not f.exists():
    return PlainTextResponse(f"index.html not found at {f}", status_code=404)
return FileResponse(f, media_type="text/html; charset=utf-8")

@app.get("/{filename}")
async def static_file(filename: str):
if filename in ("favicon.ico",):
    f = WEB_ROOT / filename
    if f.exists():
        return FileResponse(f)
    return Response(status_code=204)
f = WEB_ROOT / filename
if f.exists() and f.is_file():
    return FileResponse(f)
raise HTTPException(404)

# ---------- entrypoint ----------
if __name__ == "__main__":
import uvicorn
uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info", loop="asyncio")
