"""Read-only HTTPS smoke check for this dashboard's actual Pages release."""
import json, re, sys, time, urllib.request
from pathlib import Path
from urllib.parse import urljoin
url=sys.argv[1].rstrip('/')+'/'
for attempt in range(12):
    try:
        def get(path):
            with urllib.request.urlopen(urllib.request.Request(path,headers={'User-Agent':'meter-dashboard-release-check','Cache-Control':'no-cache'}),timeout=20) as response:
                assert response.status==200
                return response.read().decode()
        html=get(url)
        assert '<title>Current' in html, 'dashboard HTML title missing'
        assets=re.findall(r'(?:src|href)="([^"]*/assets/[^\"]+)"',html)
        assert len(assets)>=3, 'expected compiled dashboard assets'
        javascript=[]
        for asset in assets:
            text=get(urljoin(url,asset))
            if asset.endswith('.js'):javascript.append(text)
        assert any('qivwjkqkeipaivztgbyy.supabase.co' in text for text in javascript), 'live project config missing'
        assert any('sb_publishable_' in text for text in javascript), 'publishable frontend config missing'
        metadata=json.loads(get(urljoin(url,'build-info.json')))
        assert metadata['base_path'] in url, 'wrong project base path'
        if Path('build-info.json').exists():
            expected=json.loads(Path('build-info.json').read_text())
            assert metadata['source_commit']==expected['source_commit'], 'previous deployment still cached'
        print('PASS: published HTTPS dashboard, all referenced assets, live Supabase public configuration and build metadata')
        print('Verified URL:',url)
        print('Source commit:',metadata['source_commit'])
        break
    except Exception as error:
        if attempt==11:raise
        print('Waiting for published release:',type(error).__name__)
        time.sleep(5)
