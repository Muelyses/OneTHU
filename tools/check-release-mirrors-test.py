#!/usr/bin/env python3
"""Exercise release-gate failures without network or production mutation."""
import importlib.util, json, hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('mirror',Path(__file__).with_name('check-release-mirrors.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.version('OneTHU_0.11.0_arm64.apk','arm64.apk')==(0,11,0,0)
assert m.version('OneTHU_0.11.0_arm64.apk.tmp','arm64.apk') is None
assert m.version('OneTHU_0.11.0_x86.apk','arm64.apk') is None
assert m.newest([{'file_name':'OneTHU_0.9.0_arm64.apk'},{'file_name':'OneTHU_0.11.0_arm64.apk'},{'file_name':'OneTHU_0.10.0_arm64.apk'}],'arm64.apk')[0]==(0,11,0,0)
assert m.version('OneTHU_0.11.4-fix-1_arm64.apk','arm64.apk')==(0,11,4,1)
assert m.version('OneTHU_0.11.4-fix-2_arm64.apk','arm64.apk')>m.version('OneTHU_0.11.4-fix-1_arm64.apk','arm64.apk')
assert m.manifest_version('0.11.4-fix-1')=={'version':'0.11.5','displayVersion':'0.11.4-fix-1'}
assert m.manifest_version('0.11.5')=={'version':'0.11.5'}
body=b'verifiable installer';digest=hashlib.sha256(body).hexdigest();release={'tag_name':'v0.11.0','draft':False,'prerelease':False,'html_url':'https://github.com/smartThise/OneTHU/releases/tag/v0.11.0','published_at':'2026-10-21','assets':[]};entries={};payloads={};sums=[]
for platform,(directory,suffix,_) in m.PLATFORMS.items():
 name='OneTHU_0.11.0_'+suffix;url='https://example.invalid/'+name
 release['assets'].append({'name':name,'size':len(body),'digest':'sha256:'+digest,'browser_download_url':url})
 entries[directory]={'dirent_list':[{'file_name':name,'file_path':'/'+directory+'/'+name,'size':len(body),'is_dir':False}]};payloads['/'+directory+'/'+name]=body;sums.append(digest+'  '+name)
release['assets'].append({'name':'SHA256SUMS.txt','browser_download_url':'https://example.invalid/SHA256SUMS.txt'})
def fake(url):
 from urllib.parse import urlparse,parse_qs
 if url.endswith('/releases/latest'):return json.dumps(release).encode()
 if url.endswith('/SHA256SUMS.txt'):return '\n'.join(sums).encode()
 q=parse_qs(urlparse(url).query)
 if url.endswith('/latest.json') or q.get('p')==['/latest.json']:
  source='cloud' if 'cloud.tsinghua.edu.cn' in url else 'github'
  assets={}
  for platform,(directory,suffix,_) in m.PLATFORMS.items():
   name='OneTHU_0.11.0_'+suffix
   assets[platform]={'name':name,'url':'/'+directory+'/'+name if source=='cloud' else 'https://example.invalid/'+name,'size':len(body),'sha256':digest}
  return json.dumps({'version':'0.11.0','assets':assets}).encode()
 if 'dirents/' in url:return json.dumps(entries[q['path'][0].strip('/')]).encode()
 return payloads[q['p'][0]]
m.read=fake
assert len(m.verify()['assets'])==3
for failure in ['stale','size','hash','missing']:
 original=json.loads(json.dumps(entries));original_payloads=payloads.copy()
 item=entries['Android']['dirent_list'][0]
 if failure=='stale':item['file_name']='OneTHU_0.10.0_arm64.apk'
 if failure=='size':item['size']+=1
 if failure=='hash':payloads[item['file_path']]=b'x'*len(body)
 if failure=='missing':entries['Android']['dirent_list']=[]
 try:m.verify()
 except (AssertionError,ValueError,KeyError):pass
 else:raise AssertionError('gate accepted '+failure)
 entries=original;payloads=original_payloads
print('✓ semantic latest-version selection; valid release accepted; stale/missing/size/hash failures rejected')
