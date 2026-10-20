/** Small illustrative scenes explain the action without creating or changing user content. */
export function TourIllustration({lesson}:{lesson:string}) {
 const featureScenes:Record<string,{title:string;items:string[]}>= {
  explorer:{title:"保存一组正在进行的事",items:["课程标签","资料标签","工作区"]},
  onego:{title:"从 OneGO! 接着做",items:["OnePage","工作区","OneFlow"]},
  plugin:{title:"按需要扩展能力",items:["插件","小 OH","模型设置"]},
  customize:{title:"换成你习惯的样子",items:["主题","壁纸","字号","入口"]},
  campus:{title:"校园服务，一处进入",items:["学习","生活","预约","云盘"]},
  data:{title:"换台设备，继续使用",items:["同步日程","导出数据","恢复设置"]},
 };
 const scene=featureScenes[lesson];
 return <div className={"tour-scene tour-scene--"+lesson} aria-label="操作示意">
 <span className="tour-scene-caption">操作示意</span>
 {scene?<div className="tour-org-demo"><strong>{scene.title}</strong><div>{scene.items.map(item=><span key={item}>{item}</span>)}</div></div>
 :lesson==="board"?<div className="tour-board-demo"><div><small>拖动把手调整位置</small><strong>今日待办</strong><span>课程作业 · 项目进度</span></div><div><strong>便笺</strong><span>记下刚想到的事</span><i aria-hidden="true">↘</i></div></div>
 :lesson==="vault"?<div className="tour-flow"><span className="tour-demo-card">课程 / 文字 / 文件</span><span className="tour-flow-arrow">→</span><span className="tour-demo-box">暂存箱<small>按住，再拖进来</small></span></div>
 :lesson==="code"?<div className="tour-flow"><span className="tour-demo-card">准备内容</span><span className="tour-flow-arrow">→</span><span className="tour-demo-code">ON-XXXX-XXXX-XXXX-XXXX<small>分享短口令</small></span><span className="tour-flow-arrow">→</span><span className="tour-demo-card">接收</span></div>
 :lesson==="nfc"?<div className="tour-flow"><span className="tour-demo-phone">传送方<small>准备内容</small></span><span className="tour-nfc-pulse" aria-hidden="true">)))</span><span className="tour-demo-phone">接收方<small>开启接收</small></span></div>
 :lesson==="organization"?<div className="tour-org-demo"><strong>你的组织 · 绑定名片</strong><div>{["成员","文件","项目","公告"].map(x=><span key={x}>{x}</span>)}</div></div>
 :lesson==="more"?<div className="tour-services-demo">{["课程","作业","校园卡","研讨间","校历","更多…"].map(x=><span key={x}>{x}</span>)}</div>
 :lesson==="swap"?<div className="tour-org-demo"><strong>选择常用功能 → 选择放置位置</strong><div>{["01","02","03","04"].map(x=><span key={x}>{x}</span>)}</div></div>
 :lesson==="quick"?<div className="tour-services-demo">{["学习","预约","生活","信息","课表"].map(x=><span key={x}>{x}</span>)}</div>
 :<div className="tour-board-demo"><div><strong>今日待办</strong><span>接下来要做的事</span></div><div><strong>今日课程</strong><span>接下来要上的课</span></div></div>}
 </div>;
}
