#!/usr/bin/env python3
"""Public contributor snapshot from the selected Git history. Never publish author emails."""
import argparse,collections,datetime,json,pathlib,re,subprocess
parser=argparse.ArgumentParser();parser.add_argument('--ref',default='HEAD');parser.add_argument('--offline',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
def git(*argv):return subprocess.check_output(['git',*argv],cwd=root,text=True)
raw=git('log',args.ref,'--no-merges','--numstat','--format=%x1e%aN%x1f%aE%x1f%H%x1d%B%x1c')
identities={};credit=[]
code=re.compile(r'\.(?:[cm]?js|jsx|tsx?|rs|py|kts?|java|swift|sh|css|scss|html|vue|c|h|cpp)$')
exclude=re.compile(r'(?:^|/)(?:node_modules|dist|vendor|gen|generated|locales|fixtures|__snapshots__)(?:/|$)|(?:^|/)(?:pnpm-lock|package-lock)|\.min\.')
for entry in raw.split('\x1e')[1:]:
 metadata,rest=entry.split('\x1d',1);name,email,sha=metadata.split('\x1f');body,stats=rest.split('\x1c',1)
 identity=identities.setdefault(email.lower(),{'name':name,'commit':sha,'commits':0,'codeAdded':0,'codeDeleted':0});identity['commits']+=1
 for line in stats.splitlines():
  fields=line.split('\t',2)
  if len(fields)!=3:continue
  added,deleted,path=fields
  if added.isdigit() and code.search(path) and not exclude.search(path):identity['codeAdded']+=int(added);identity['codeDeleted']+=int(deleted)
 for coauthor in re.findall(r'^Co-authored-by:\s*(.*?)\s*<([^>]+)>',body,re.M|re.I):credit.append(coauthor)
# Include authors of merge-only commits and coauthors without attributing duplicated line totals.
for row in git('log',args.ref,'--format=%aN%x1f%aE%x1f%H').splitlines():
 name,email,sha=row.split('\x1f');identities.setdefault(email.lower(),{'name':name,'commit':sha,'commits':0,'codeAdded':0,'codeDeleted':0})
for name,email in credit:identities.setdefault(email.lower(),{'name':name,'commit':None,'commits':0,'codeAdded':0,'codeDeleted':0})
alias_path=root/'docs/contributor-identities.json'
aliases=json.loads(alias_path.read_text()) if alias_path.exists() else {}
people={}
for email,item in identities.items():
 login=aliases.get(item['name'])
 if not login and not args.offline and item['commit']:
  try:
   info=json.loads(subprocess.check_output(['gh','api','repos/smartThise/OneTHU/commits/'+item['commit']],text=True,stderr=subprocess.DEVNULL,timeout=20));login=(info.get('author') or {}).get('login')
  except (subprocess.CalledProcessError,subprocess.TimeoutExpired,FileNotFoundError,json.JSONDecodeError):pass
 key=('github:'+login.lower()) if login else ('name:'+item['name'].casefold())
 public=people.setdefault(key,{'name':login or item['name'],'github':('https://github.com/'+login) if login else None,'commits':0,'codeAdded':0,'codeDeleted':0})
 for field in ['commits','codeAdded','codeDeleted']:public[field]+=item[field]
# Coauthor records often repeat a GitHub login without a resolvable commit.
for key,person in list(people.items()):
 target=people.get('github:'+person['name'].lower())
 if key.startswith('name:') and target is not None:
  for field in ['commits','codeAdded','codeDeleted']:target[field]+=person[field]
  del people[key]
for person in people.values():person['major']=person['codeAdded']>10000
report={'ref':git('rev-parse',args.ref).strip(),'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'majorThreshold':10000,'metric':'Cumulative added source-code lines in reachable dev3 history; non-merge commits, excluding generated/vendor/locales/fixtures and non-code files. GitHub account aliases combined when resolvable. Coauthors and merge-only authors are listed without duplicated line attribution. Not a ranking of impact.','contributors':sorted(people.values(),key=lambda item:(-item['codeAdded'],item['name'].casefold()))}
(root/'docs/contributors.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for en in [False,True]:
 lines=['# '+('Contributors' if en else '贡献者'),'','[中文](../contributors.md) · English' if en else '中文 · [English](en/contributors.md)','',('Snapshot of `dev3` history. **Major contributor** means more than **10,000 cumulative added source-code lines**, excluding merge duplication, generated/vendor code, localization dictionaries, fixtures and non-code files. GitHub identities are combined when resolvable. All authors and recorded coauthors remain listed; unresolvable aliases may remain separate. Line counts are not a measure of contribution quality.' if en else '统计 `dev3` 可追溯历史。**主要贡献者**为累计新增代码严格超过 **10,000 行**的贡献者；不重复计算合并提交，不计生成代码、依赖、语言词典、测试夹具及非代码文件。可识别的 GitHub 身份会合并；列出所有作者及署名共同作者，无法识别的别名可能仍单独显示。行数不代表贡献质量。'),'','| '+('Contributor | Added code lines | Non-merge commits | Role |' if en else '贡献者 | 新增代码行数 | 非合并提交 | 标记 |'),'|---|---:|---:|---|']
 for p in report['contributors']:
  name=p['name'].replace('|','\\|').replace('<','&lt;').replace('>','&gt;');name=f"[{name}]({p['github']})" if p['github'] else name
  lines.append(f"| {name} | {p['codeAdded']:,} | {p['commits']} | {('Major contributor' if en else '主要贡献者') if p['major'] else '—'} |")
 lines+=['',f"{'Source commit' if en else '统计提交'}: `{report['ref']}`",f"{'Generated' if en else '生成时间'}: {report['generatedAt']}",'',('Regenerate with `python3 tools/contributors-report.py`. Public output does not include author emails.' if en else '通过 `python3 tools/contributors-report.py` 重新生成；公开产物不包含作者邮箱。')]
 path=root/'docs'/('en/contributors.md' if en else 'contributors.md');path.parent.mkdir(exist_ok=True);path.write_text('\n'.join(lines)+'\n')
print(json.dumps({'contributors':len(people),'major':[p['name'] for p in report['contributors'] if p['major']]}))
