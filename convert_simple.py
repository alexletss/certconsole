import codecs

with codecs.open('employees_import_source.sql', 'r', 'utf-8') as f:
    lines = f.readlines()

records = []
for line in lines:
    line = line.strip()
    if not line.startswith('INSERT'):
        continue
    # Находим часть между VALUES ( и ) ON CONFLICT
    start = line.find("VALUES (")
    end = line.find(") ON CONFLICT")
    if start == -1 or end == -1:
        continue
    values_str = line[start + 8:end]  # Пропускаем "VALUES ("

    # Разбиваем по запятым, учитывая кавычки
    values = []
    current = ""
    in_quotes = False
    for char in values_str:
        if char == "'" and (not current or current[-1] != "\\"):
            in_quotes = not in_quotes
            current += char
        elif char == "," and not in_quotes:
            values.append(current.strip())
            current = ""
        else:
            current += char
    if current:
        values.append(current.strip())

    if len(values) >= 6:
        login = values[0].strip("'")
        name = values[1].strip("'")
        records.append((login, name))

with codecs.open('cert_import_doctors.sql', 'w', 'utf-8') as f:
    f.write('BEGIN;\n')
    for login, name in records:
        parts = name.split()
        lastname = parts[0] if len(parts) > 0 else ''
        firstname = parts[1] if len(parts) > 1 else ''
        middlename = parts[2] if len(parts) > 2 else ''
        f.write("INSERT INTO certificates (id, dept, lastname, firstname, middlename, position, treasury, purposes, expiry, dekret) VALUES ('%s', 'doctors', '%s', '%s', '%s', '', false, '[]'::jsonb, NULL, NULL);\n" % (login, lastname, firstname, middlename))
    f.write('COMMIT;\n')

print('Created cert_import_doctors.sql with', len(records), 'records')