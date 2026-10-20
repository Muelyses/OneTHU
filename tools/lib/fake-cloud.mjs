/**
 * 浏览器验收用的「假清华云盘」（仅测试，不联网、不写真实云盘）：
 *
 * - addInitScript 注入 window.__cloud：文件系统/分享台账经 localStorage 在多个页面间
 *   共享，从而模拟「发送方已连接云盘、接收方完全没有云盘登录」的两个独立客户端；
 * - route 拦截把 seafile.ts / vaultCloud.ts 里的 invoke 换成 window.__cloudInvoke，
 *   并让 getSeafileToken 读 window.__cloud.token（空串 = 未连接云盘 → 匿名接收路径）；
 * - 支持公开/密文分享、资料库权限和组织页面所需命令。
 * - 这是旧浏览器流程夹具，账号用可变的 cloud.email 模拟，不能作为真实身份隔离证据；
 *   安全性另由 private-cloud 夹具和显式真实服务测试验证。
 *
 * window.__cloud.rejectDirShare = true 时第一次目录分享被拒，强制走
 * 「退化为分享 manifest.json 文件」的兜底分支（对应云盘 /f/ 文件分享链接）。
 */
export async function installFakeCloud(page, { token = 'test-token' } = {}) {
  await page.addInitScript((token) => {
    const KEY = 'onethu.test.cloud.v1';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* 忽略坏状态 */ }
    const cloud = {
      token,
      fs: saved?.fs ?? {},        /* repoId → { '/Vault/shares/<id>/manifest.json': text } */
      shares: saved?.shares ?? {}, /* shareToken → { dir, file, expiresAt } */
      temps: {},
      seq: saved?.seq ?? 0,
      rejectDirShare: false,
      /* 组织页用：资料库（repo）台账、当前账号邮箱、按邮箱共享记录 */
      repos: saved?.repos ?? [{ id: 'repo-one', name: 'OneTHU', owner: 'tester@mails.tsinghua.edu.cn' }],
      email: saved?.email ?? 'tester@mails.tsinghua.edu.cn',
      sharedTo: saved?.sharedTo ?? [],
    };
    window.__cloud = cloud;
    const save = () => {
      try { localStorage.setItem(KEY, JSON.stringify({ fs: cloud.fs, shares: cloud.shares, seq: cloud.seq, repos: cloud.repos, email: cloud.email, sharedTo: cloud.sharedTo })); } catch { /* 忽略配额 */ }
    };
    const REPO = 'repo-one';
    const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    const tokenOfLink = (link) => {
      const m = String(link).match(/\/(?:d|f)\/([A-Za-z0-9_-]+)/);
      return m ? m[1] : null;
    };
    window.__cloudInvoke = async (cmd, args) => {
      switch (cmd) {
        case 'seafile_repos': return cloud.repos.map((r) => ({ ...r, mtime: 0, size: 0, repoType:r.owner===cloud.email?'mine':'shared', permission:r.owner===cloud.email?'rw':'r', isVirtual:false }));
        case 'seafile_account': return { name: '测试用户', email: cloud.email, usage: 0, total: 1024 * 1024 };
        case 'seafile_create_repo': {
          const name = String(args?.name ?? '').trim() || '未命名资料库';
          const hit = cloud.repos.find((r) => r.name === name);
          if (hit) return { id: hit.id };
          const repo = { id: crypto.randomUUID(), name, owner:cloud.email };
          cloud.repos.push(repo);
          save();
          return { id: repo.id };
        }
        case 'seafile_assert_account_acl': return null;
        case 'seafile_repo_owner': return cloud.repos.find(r=>r.id===args.repoId)?.owner ?? 'tester@mails.tsinghua.edu.cn';
        case 'seafile_repo_user_shares': return cloud.sharedTo.filter(s=>s.repoId===args.repoId).map(s=>({email:s.email,permission:s.permission}));
        case 'seafile_set_repo_user_permission': return window.__cloudInvoke('seafile_share_folder_to_user',{...args,path:'/'});
        case 'seafile_remove_repo_user_share': {
          cloud.sharedTo=cloud.sharedTo.filter(s=>!(s.repoId===args.repoId && s.email===args.email));save();return null;
        }
        case 'seafile_delete_repo': {
          cloud.repos=cloud.repos.filter(r=>r.id!==args.repoId);delete cloud.fs[args.repoId];cloud.sharedTo=cloud.sharedTo.filter(s=>s.repoId!==args.repoId);save();return null;
        }
        case 'seafile_upload_text': {
          (cloud.fs[args.repoId]??={})[`${String(args.parentDir).replace(/\/$/,'')}/${args.name}`]=args.content;save();return String(args.content).length;
        }
        case 'read_file_base64': {
          const text=cloud.temps[args.path]??`假文件内容:${args.path}`;
          return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
        }
        case 'seafile_share_folder_to_user': {
          const email = String(args?.email ?? '');
          if (!email.includes('@')) throw new Error('云盘邮箱不合法');
          const item = { repoId: String(args?.repoId ?? ''), path: String(args?.path ?? ''), email, permission: String(args?.permission ?? 'rw') };
          /* 去重：同库同路径同邮箱重复共享只留一条（真实云盘是幂等的） */
          const hit = cloud.sharedTo.findIndex((x) => x.repoId === item.repoId && x.path === item.path && x.email === item.email);
          if (hit >= 0) cloud.sharedTo[hit] = item;
          else cloud.sharedTo.push(item);
          save();
          return null;
        }
        case 'seafile_read_bytes': {
          const owner=cloud.repos.find(r=>r.id===args.repoId)?.owner;
          if(!args.token || owner && owner!==cloud.email && !cloud.sharedTo.some(s=>s.repoId===args.repoId&&s.email===cloud.email))throw new Error('403 Forbidden');
          const repo = cloud.fs[String(args?.repoId ?? '')] ?? {};
          const text = repo[String(args?.path ?? '')];
          if (text === undefined) throw new Error('分享里没有这个文件');
          const b64 = (() => { const bytes = new TextEncoder().encode(text); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); })();
          return b64;
        }
        case 'seafile_dir': {
          const repo = cloud.fs[String(args?.repoId ?? '')] ?? {};
          const base = String(args?.path ?? '/').replace(/\/$/, '') || '';
          const prefix = (base === '' ? '/' : base + '/').replace(/^\/+/, '/');
          const seen = new Map();
          for (const key of Object.keys(repo)) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            if (!rest) continue;
            const [head, ...tail] = rest.split('/');
            if (!head) continue;
            const kind = tail.length ? 'dir' : 'file';
            if (!seen.has(head)) seen.set(head, { name: head, kind, size: kind === 'file' ? repo[key].length : 0 });
          }
          return Array.from(seen.values()).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
        }
        case 'seafile_mkdir': return null;
        case 'write_temp_file': {
          /* 与 Rust write_temp_file 同口径：只取 basename，落 onethu-tmp 目录——
             上传目的地名取自本地文件 basename，必须保持 manifest.json 才能被分享读取按名取到。 */
          const safe = String(args?.name ?? 'file').split('/').pop();
          const path = `/tmp/onethu-tmp/${safe}`;
          /* 与 Rust 同口径：base64 → 字节 → UTF-8 文本（直接 atob 会把中文按 Latin-1 弄成乱码） */
          const bin = atob(args?.dataBase64 ?? '');
          cloud.temps[path] = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
          return path;
        }
        case 'seafile_upload': {
          const name = String(args.localPath).split('/').pop();
          const text = cloud.temps[args.localPath] ?? `假文件内容:${args.localPath}`;
          (cloud.fs[args.repoId] ??= {})[`${args.parentDir.replace(/\/$/, '')}/${name}`] = text;
          save(); /* 必须落 localStorage：接收方是另一个页面，靠它 hydrate 出同一片云 */
          return text.length;
        }
        case 'seafile_share': {
          const p = String(args.path);
          if (cloud.rejectDirShare && !p.endsWith('.json')) throw new Error('目录分享被云盘策略拒绝（假云盘夹具）');
          const token = hex(20);
          cloud.shares[token] = {
            repoId:args.repoId,
            dir: p.replace(/\/manifest\.json$/, ''),
            file: p.endsWith('.json') ? p : null,
            expiresAt: args.expireDays > 0 ? Date.now() + args.expireDays * 86400_000 : 0,
          };
          cloud.seq++;
          save();
          return { link: `https://cloud.tsinghua.edu.cn/d/${token}/`, token };
        }
        case 'seafile_share_read': {
          const token = tokenOfLink(args.link);
          const share = token && cloud.shares[token];
          if (!share) throw new Error('分享不存在或已被撤销');
          if (share.expiresAt && Date.now() > share.expiresAt) throw new Error('分享链接已过期');
          const fs = cloud.fs[share.repoId??REPO] ?? {};
          const text = share.file ? fs[share.file] : fs[`${share.dir}/${args.name ?? 'manifest.json'}`];
          if (text === undefined) throw new Error('分享里没有这个文件');
          return text;
        }
        case 'seafile_share_read_bytes': {
          const token=tokenOfLink(args.link),share=token&&cloud.shares[token];
          if(!share || share.expiresAt && Date.now()>share.expiresAt)throw Error('分享不存在或已被撤销');
          const text=(cloud.fs[share.repoId??REPO]??{})[`${share.dir}/${String(args.path).replace(/^\//,'')}`];
          if(text===undefined)throw Error('分享里没有这个文件');
          return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
        }
        case 'seafile_share_delete': {
          delete cloud.shares[String(args.shareToken)];
          save();
          return null;
        }
        case 'seafile_delete': {
          const prefix = String(args.path).replace(/\/$/, '');
          for (const repo of [cloud.fs[args.repoId]??{}]) {
            for (const key of Object.keys(repo)) if (key === prefix || key.startsWith(prefix + '/')) delete repo[key];
          }
          save();
          return null;
        }
        default: throw new Error(`假云盘未实现的命令：${cmd}`);
      }
    };
  }, token);
  for (const mod of ['**/src/state/seafile.ts*', '**/src/state/vaultCloud.ts*', '**/src/state/sealedShare.ts*', '**/src/state/cloudExchange.ts*', '**/src/lib/fileChannel.ts*', '**/src/lib/cardCover.ts*', '**/src/lib/cloudFolder.ts*', '**/src/lib/ownedCloudRepo.ts*']) {
    await page.route(mod, async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      body = body.replace(/import \{ invoke \} from [^;]+;/, 'const invoke = window.__cloudInvoke;');
      // Browser file selection still follows the app's native staging contract.
      // Keep the bytes in fixture temps instead of dropping the attachment path.
      body = body.replace('!localPath && isTauri', '!localPath');
      /* 未连接云盘 = token 空串；getSeafileToken 改读夹具状态 */
      body = body.replace('return cfg?.token ?? "";', 'return window.__cloud.token ?? cfg?.token ?? "";');
      /* 让 seafile 模块认为自己已配置（cfg 是模块私有）：否则 seafileShareDelete 等
         会走「云盘未配置」分支，撤销链路在夹具里跑不到。 */
      body = body.replace('loaded = true;', 'loaded = true; cfg = { token: window.__cloud.token };');
      await route.fulfill({ response, body });
    });
  }
}

/** 清空应用侧本地状态（模拟一台全新设备），保留假云盘里的分享内容。 */
export async function freshClientState(page) {
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k !== 'onethu.test.cloud.v1' && k !== 'onethu.onboarded.phone') localStorage.removeItem(k);
    }
  });
}
