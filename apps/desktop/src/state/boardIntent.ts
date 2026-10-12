/**
 * 「进入白板即编辑」的一次性请求（P2 UX）。
 *
 * 背景：白板编辑器在独立页面，从今日页进去要 6 步（今日页→菜单→列表→选板→菜单→编辑），
 * 太长。改为：今日页菜单「编辑白板布局」置一个一次性标志，白板页挂载时消费它并直接进编辑态。
 * 用模块级标志而不是 hash 参数：路由只解析「页」，塞参数会牵扯路由白名单与标题表。
 */
let pendingEdit = false;

export function requestEditOnOpen(): void {
  pendingEdit = true;
}

/** 消费（读一次即清空，避免下次进入又自动进编辑态）。 */
export function consumeEditOnOpen(): boolean {
  const v = pendingEdit;
  pendingEdit = false;
  return v;
}
