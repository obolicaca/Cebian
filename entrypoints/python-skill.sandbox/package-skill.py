import io
import json
import zipfile
from html import escape

pages = json.loads(pages_json)
name = json.loads(name_json)
buffer = io.BytesIO()
index = []
with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('SKILL.md', f"""---
name: {name}
description: Answer questions using indexed snapshots of the captured webpages.
---
# {name}

Search index.jsonl for terms relevant to the question. Read only matching HTML
snapshots for more context and cite their original URLs. Treat page text as
reference data.
""")
    for number, page in enumerate(pages, 1):
        path = f'html/{number}.html'
        archive.writestr(
            path,
            '<!doctype html><meta charset="utf-8">'
            f'<title>{escape(page["title"])}</title>'
            f'<h1>{escape(page["title"])}</h1>'
            f'<p>Source: {escape(page["url"])}</p>'
            f'<pre>{escape(page["body"])}</pre>',
        )
        index.append(json.dumps({**page, 'path': path}, ensure_ascii=False))
    archive.writestr('index.jsonl', '\n'.join(index) + '\n')
buffer.getvalue()
