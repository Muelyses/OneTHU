/** Shared real-button walkthrough: assertions cover destinations, not source-code strings. */
export async function walkFullOnboarding(page, check) {
  const tour = page.getByRole('dialog', { name: 'OneTHU 使用导览' });
  const cases = [
    ['白板与 OnePage：首页由你摆', '去看看白板', 'home'],
    ['标签页与工作区：多任务不打架', '打开工作区入口', 'workspaces'],
    ['暂存箱：什么都能先收进来', '打开暂存箱', 'vault'],
    ['一个短口令，传递一组内容', '查看收发入口', 'code'],
    ['碰一碰：名片与内容接力', '打开收发入口', 'nfc'],
    ['组织：人、文件、项目一处管', '打开组织', 'organization'],
    ['OneGO!：全局入口与自动化', '打开 OneGO!', 'onego'],
    ['插件与 OH：把能力装进来', '看看插件页', 'plugins'],
    ['外观与工作台：全都可调', '打开外观设置', 'appearance'],
    ['校园服务：完整模式的聚合', '去学习页', 'learn'],
    ['数据与同步：跨设备继续', '查看数据设置', 'data'],
  ];
  for (const [title, action, destination] of cases) {
    await tour.getByRole('heading', { name: title, exact: true }).waitFor();
    await tour.getByRole('button', { name: action, exact: true }).click();
    await tour.waitFor({ state: 'hidden' });
    if (destination === 'home') {
      await page.locator('[data-tab-page="homepage"]:visible .freeboard').waitFor();
    } else if (['vault', 'code', 'nfc'].includes(destination)) {
      const vault = page.locator('[data-tab-page="vault"]:visible');
      await vault.getByRole('button', { name: '接收', exact: true }).waitFor();
      if (destination === 'code') check(await vault.getByRole('button', { name: '分享口令', exact: true }).isVisible(), '口令导览到达统一分享入口');
      if (destination === 'nfc') {
        await vault.getByRole('button', { name: '接收', exact: true }).click();
        const receive = page.getByRole('dialog', { name: '接收内容' });
        await receive.waitFor();
        check(await receive.getByRole('button', { name: 'NFC 接收', exact: true }).isVisible(), '碰一碰导览可进入 NFC 设备支持界面');
        await page.keyboard.press('Escape');
        await receive.waitFor({ state: 'hidden' });
      }
    } else if (destination === 'organization') {
      const contacts = page.locator('[data-tab-page="contacts"]:visible');
      await contacts.getByRole('button', { name: '新建组织', exact: true }).waitFor();
      check(await contacts.getByRole('radio', { name: '我的组织', exact: true }).getAttribute('aria-checked') === 'true', '组织导览直达我的组织分栏');
    } else if (destination === 'onego' || destination === 'workspaces') {
      const sheet = page.getByRole('dialog', { name: 'OneGO!', exact: true });
      await sheet.waitFor();
      check(await sheet.getByRole('tab', { name: destination === 'onego' ? '我的收藏' : '工作区', exact: true }).getAttribute('aria-selected') === 'true', action + '选择正确分栏');
      await sheet.getByRole('button', { name: '完成', exact: true }).click();
      await sheet.waitFor({ state: 'hidden' });
    } else if (['plugins', 'appearance', 'data'].includes(destination)) {
      const settings = page.getByRole('dialog', { name: '我的', exact: true });
      await settings.waitFor();
      if (destination === 'plugins') await settings.getByRole('heading', { name: '插件', exact: true }).waitFor();
      else await settings.getByRole('tabpanel', { name: destination === 'appearance' ? '外观与布局' : '数据与同步', exact: true }).waitFor();
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
    } else if (destination === 'learn') {
      await page.locator('[data-tab-page="learn"]:visible').getByRole('heading', { name: '课程', exact: true }).waitFor();
    }
    check(true, '完整导览真实到达：' + action);
    await page.getByRole('button', { name: '继续导览', exact: true }).click();
    await tour.getByRole('heading', { name: title, exact: true }).waitFor();
    await tour.getByRole('button', { name: '下一步', exact: true }).click();
  }
  await tour.getByRole('heading', { name: '需要时，再连接', exact: true }).waitFor();
  check(await tour.getByRole('switch', { name: 'OH MCP 服务器开关' }).count() === 1, '完整模式可选择开放 OH MCP');
}

/** Release test routes and requests before closing; cleanup failures remain failures. */
export async function closeTestBrowser(browser) {
  let timer,phase="routes";
  try {
    await Promise.race([
      (async()=>{
        for(const context of browser.contexts()) {
          for(const page of context.pages()) await page.unrouteAll({behavior:'ignoreErrors'}).catch(()=>{});
          phase="request.dispose";await context.request.dispose();
          phase="context.close";await context.close();
        }
        phase="browser.close";await browser.close();
      })(),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Browser cleanup exceeded 15 seconds: '+phase)),15000);}),
    ]);
  } finally {clearTimeout(timer);}
}
