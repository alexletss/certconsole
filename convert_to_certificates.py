import re, codecs

with codecs.open('employees_import_source.sql', 'r', 'utf-8') as f:
	content = f.read()

# Парсим INSERT строки из users
pattern = r"INSERT INTO users \\(login, name, pass_hash, role, department_id, created_at\\) VALUES \\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', NOW\\(\\)\\) ON CONFLICT \\(login\\) DO NOTHING;"
matches = re.findall(pattern, content)

with codecs.open('cert_import_doctors.sql', 'w', 'utf-8') as f:
	f.write('BEGIN;\n')
	for login, name, pass_hash, role, dept in matches:
		parts = name.split()
		lastname = parts[0] if len(parts) > 0 else ''
		firstname = parts[1] if len(parts) > 1 else ''
		middlename = parts[2] if len(parts) > 2 else ''
		f.write("INSERT INTO certificates (id, dept, lastname, firstname, middlename, position, treasury, purposes, expiry, dekret) VALUES ('%s', 'doctors', '%s', '%s', '%s', '', false, '[]'::jsonb, NULL, false);\n" % (login, lastname, firstname, middlename))
	f.write('COMMIT;\n')

print('Created cert_import_doctors.sql with', len(matches), 'records')