#!/usr/bin/env python3
"""Verify latest public cloud platform directories against the latest GitHub release.
No login or cloud token is used. A failed/missing/stale platform blocks publication.
"""
import argparse, hashlib, json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = 'https://cloud.tsinghua.edu.cn'
TOKEN = '56f78a2a0b144a6ab737'
SHARE = f'{BASE}/d/{TOKEN}/'
REPO = 'https://github.com/smartThise/OneTHU'
PLATFORMS = {'macos': ('macOS', 'aarch64.dmg', 'Apple Silicon'),
             'windows': ('Windows', 'x64-setup.exe', 'x64'),
             'android': ('Android', 'arm64.apk', 'ARM64')}

def read(url):
    headers = {'User-Agent': 'OneTHU-release-mirror-check', 'Accept': '*/*'}
    if url.startswith('https://api.github.com/') and os.getenv('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    with urlopen(Request(url, headers=headers), timeout=120) as response:
        return response.read()

def download_url(path):
    return SHARE + 'files/?' + urlencode({'p': path, 'dl': '1'})

def version(name, suffix):
    match = re.fullmatch(r'OneTHU_(\d+)\.(\d+)\.(\d+)(?:-fix-(\d+))?_' + re.escape(suffix), name)
    return tuple(int(x or 0) for x in match.groups()) if match else None

def manifest_version(actual):
    # Installed 0.11.4 compares only three components. Advertise the next patch
    # while newer clients use displayVersion to compare the actual hotfix.
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)-fix-\d+', actual)
    if not match:
        return {'version': actual}
    major, minor, patch = map(int, match.groups())
    return {'version': f'{major}.{minor}.{patch + 1}', 'displayVersion': actual}

def newest(entries, suffix):
    candidates = [(version(e.get('file_name', ''), suffix), e) for e in entries if not e.get('is_dir')]
    candidates = [(v, e) for v, e in candidates if v is not None]
    if not candidates:
        raise ValueError('No compatible release installer: ' + suffix)
    return max(candidates, key=lambda item: item[0])

def verify(output=None, manifests=None):
    release = json.loads(read('https://api.github.com/repos/smartThise/OneTHU/releases/latest'))
    tag = release['tag_name']
    assert not release['draft'] and not release['prerelease']
    expected = version('OneTHU_'+tag.removeprefix('v')+'_asset', 'asset')
    assert expected is not None
    github = {a['name']: a for a in release['assets']}
    assert 'SHA256SUMS.txt' in github, 'GitHub release lacks checksums'
    checksums = {}
    for line in read(github['SHA256SUMS.txt']['browser_download_url']).decode().splitlines():
        digest, name = line.split(None, 1)
        assert re.fullmatch(r'[a-f0-9]{64}', digest)
        checksums[name.lstrip('* ')] = digest
    assets = {}
    for platform, (directory, suffix, arch) in PLATFORMS.items():
        listing = json.loads(read(BASE + '/api/v2.1/share-links/' + TOKEN + '/dirents/?' + urlencode({'path': '/' + directory + '/'})))
        entries = listing if isinstance(listing, list) else listing['dirent_list']
        selected, entry = newest(entries, suffix)
        assert selected == expected, f'{directory}: latest cloud version {selected} differs from GitHub {tag}'
        name = entry['file_name']; path = '/' + directory + '/' + name
        assert entry['file_path'] == path, 'Unexpected platform file path'
        asset = github[name]
        assert asset['size'] == entry['size'] > 0, directory + ': size mismatch'
        digest = checksums[name]
        if asset.get('digest'):
            assert asset['digest'] == 'sha256:' + digest, directory + ': GitHub digest mismatch'
        # Download anonymously from the stable share path, not a temporary seafhttp URL.
        data = read(download_url(path))
        assert len(data) == asset['size'] and hashlib.sha256(data).hexdigest() == digest, directory + ': download checksum mismatch'
        assets[platform] = {'name': name, 'version': tag.removeprefix('v'), 'directory': '/' + directory + '/',
                            'architecture': arch, 'size': len(data), 'sha256': digest,
                            'url': download_url(path), 'githubUrl': asset['browser_download_url'],
                            'folderUrl': SHARE + '?' + urlencode({'p': '/' + directory + '/'}),
                            'anonymousDownloadVerified': True}
        print(f'✓ {directory}: {name} — anonymous download, size and SHA256 match GitHub', flush=True)
    if not manifests:
        for source, url in [('cloud', download_url('/latest.json')), ('github', REPO + '/releases/latest/download/latest.json')]:
            manifest = json.loads(read(url))
            assert manifest.get('displayVersion',manifest['version']) == tag.removeprefix('v'), source + ': stale update manifest'
            for platform, asset in assets.items():
                published = manifest['assets'][platform]
                expected_url = asset['directory'] + asset['name'] if source == 'cloud' else asset['githubUrl']
                assert published['url'] == expected_url and published['name'] == asset['name'], source + ': wrong platform URL'
                assert published['size'] == asset['size'] and published['sha256'] == asset['sha256'], source + ': manifest checksum mismatch'
            print('✓ ' + source + ' latest.json: all platform URLs, versions and checksums match', flush=True)
    report = {'version': tag.removeprefix('v'), 'releaseUrl': release['html_url'], 'mirrorUrl': SHARE,
              'verifiedAt': datetime.now(timezone.utc).isoformat(), 'assets': assets}
    if output:
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        Path(output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if manifests:
        dest = Path(manifests); dest.mkdir(parents=True, exist_ok=True)
        for source in ['cloud', 'github']:
            manifest = {**manifest_version(report['version']), 'releasedAt': release['published_at'],
                        'notes': release.get('name', tag) + ' — ' + release['html_url'], 'assets': {}}
            for platform, asset in assets.items():
                directory = asset['directory']
                manifest['assets'][platform] = {'name': asset['name'], 'url': directory + asset['name'] if source == 'cloud' else asset['githubUrl'],
                                                'size': asset['size'], 'sha256': asset['sha256']}
            (dest / (source + '-latest.json')).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', help='Write verified website download snapshot')
    parser.add_argument('--manifests', help='Write cloud/github latest.json files to this directory')
    args = parser.parse_args()
    try:
        verify(args.output, args.manifests)
    except Exception as error:
        print('✗ Release mirror verification failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
