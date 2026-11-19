from pathlib import Path
import base64

root = Path(__file__).resolve().parent.parent
source = root / 'beyspot'
html = (source / 'index.html').read_text()
logo = base64.b64encode((source / 'assets/beybe-radar-logo.png').read_bytes()).decode('ascii')
html = html.replace('src="assets/beybe-radar-logo.png"', 'src="data:image/png;base64,' + logo + '"')
for name in ['vendor/leaflet.css', 'styles.css']:
    html = html.replace('<link rel="stylesheet" href="' + name + '">', '<style>\n' + (source / name).read_text() + '\n</style>')
for name in ['vendor/leaflet.js', 'vendor/supabase.min.js', 'config.js', 'core.js', 'app.js']:
    code = (source / name).read_text().replace('</script', '<\\/script')
    html = html.replace('<script src="' + name + '"></script>', '<script>\n' + code + '\n</script>')
html = html.replace('<link rel="preconnect" href="https://unpkg.com">\n', '')
licenses = '\n\n'.join((source / name).read_text() for name in ['vendor/leaflet-LICENSE.txt', 'vendor/supabase-LICENSE.txt'])
html = html.replace('</body>', '<script type="text/plain" id="third-party-licenses">\n' + licenses + '\n</script>\n</body>')
schema = (root / 'supabase/schema.sql').read_text()
html = html.replace('</body>', '<script type="text/plain" id="database-schema">\n' + schema + '\n</script>\n</body>')
for relative in ['outputs/Beybe_Radar_preview.html']:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html)
print('Built self-contained preview:', len(html.encode()), 'bytes')
