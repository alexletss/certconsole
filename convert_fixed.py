import re, codecs

with codecs.open('employees_import_source.sql', 'r', 'utf-8') as f:
lines = f.readlines()

records = []
for line in lines:
line = line.strip()
if not line.startswith('INSERT'):
    continue
# Простой парсинг: ищем VALUES ('...', '...', ...)
match = re.search(r"VALUES \('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', NOW\(\)\) ON CONFLICT", line)
if match:
    login, name, pass_hash, role, dept = match.groups()
    records.append((login, name, pass_hash, role, dept))

with codecs.open('cert_import_doctors.sql', 'w', 'utf-8') as f:
f.write('BEGIN;
')
for login, name, pass_hash, role, dept in records:
    parts = name.split()
    lastname = parts[0] if len(parts) > 0 else ''
    firstname = parts[1] if len(parts) > 1 else ''
    middlename = parts[2] if len(parts) > 2 else ''
    f.write("INSERT INTO certificates (id, dept, lastname, firstname, middlename, position, treasury, purposes, expiry, dekret) VALUES ('%s', 'doctors', '%s', '%s', '%s', '', false, '[]'::jsonb, NULL, false);
" % (login, lastname, firstname, middlename))
f.write('COMMIT;')

print('Created cert_import_doctors.sql with', len(records), 'records')