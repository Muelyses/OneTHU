import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Resolved OneGUI material colours. Each assembly owns and disposes its resources. */
export interface StudioPalette {
  body: string; edge: string; glass: string; screen: string; ink: string;
  muted: string; paper: string; accent: string; accentInk: string; note: string;
}
export interface StudioAssembly {
  group: THREE.Group;
  pose(progress: number): void;
  dispose(): void;
}
interface FaceContent {
  eyebrow?: string; title: string; subtitle?: string; rows?: string[];
  badge?: string; background?: string; compact?: boolean; display?: boolean; completed?: boolean; foreground?: string;
}
const mix = THREE.MathUtils.lerp;
const clamp = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);

/** Real bevelled solids under every face; canvas textures contain only typography/UI. */
export function createStudioAssembly(lesson: string, palette: StudioPalette): StudioAssembly {
  const group = new THREE.Group(); group.name = `studio-assembly-${lesson}`;
  const updateFaces: Array<(progress: number) => void> = [];
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  const keepGeometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const material = (color: string, properties: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshPhysicalMaterial => {
    const result = new THREE.MeshPhysicalMaterial({ color, roughness: .4, metalness: .05, envMapIntensity: .9, ...properties });
    materials.add(result); return result;
  };
  const aluminium = material(palette.edge, { metalness: .82, roughness: .26, clearcoat: .25 });
  const ceramic = material(palette.body, { metalness: .16, roughness: .28, clearcoat: .8, clearcoatRoughness: .18 });
  const paper = material(palette.paper, { roughness: .62, metalness: 0 });
  const glass = material(palette.glass, { metalness: .18, roughness: .12, clearcoat: 1, clearcoatRoughness: .08 });
  const ink = material(palette.ink, { metalness: .12, roughness: .26 });
  function solid(width: number, height: number, depth: number, radius: number, surface: THREE.Material, name?: string): THREE.Mesh {
    const mesh = new THREE.Mesh(keepGeometry(new RoundedBoxGeometry(width, height, depth, 4, Math.min(radius, width / 2, height / 2, depth / 2))), surface);
    mesh.name = name ?? "studio-solid"; mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  }
  function outline(width: number, height: number, radius: number): THREE.Shape {
    const x = -width / 2, y = -height / 2, r = Math.min(radius, width / 2, height / 2);
    const shape = new THREE.Shape(); shape.moveTo(x + r, y); shape.lineTo(x + width - r, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + r); shape.lineTo(x + width, y + height - r);
    shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height); shape.lineTo(x + r, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - r); shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
    return shape;
  }
  // XY corner radius is independent of slab depth. A phone must not become a box
  // with tiny corners merely because its metal frame is thin.
  function plate(width: number, height: number, depth: number, radius: number, surface: THREE.Material, name?: string): THREE.Mesh {
    const bevel = Math.min(.018, depth * .2);
    const geometry = keepGeometry(new THREE.ExtrudeGeometry(outline(width - bevel * 2, height - bevel * 2, radius - bevel), {
      depth: depth - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, steps: 1, curveSegments: 12,
    }));
    geometry.translate(0, 0, -depth / 2 + bevel);
    const mesh = new THREE.Mesh(geometry, surface); mesh.name = name ?? "studio-plate"; mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  }
  function roundedFace(width: number, height: number, radius: number, surface: THREE.Material): THREE.Mesh {
    const shape = outline(width, height, radius);
    const geometry = keepGeometry(new THREE.ShapeGeometry(shape, 12)), positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    for (let index = 0; index < positions.count; index++) uv.setXY(index, (positions.getX(index) + width / 2) / width, (positions.getY(index) + height / 2) / height);
    const mesh = new THREE.Mesh(geometry, surface); mesh.receiveShadow = true; return mesh;
  }
  function canvasFace(width: number, height: number, content: FaceContent): THREE.Mesh {
    const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = Math.round(768 * height / width);
    const ctx = canvas.getContext("2d");
    if (!ctx) return roundedFace(width, height, .07, paper);
    const unit = canvas.width / width; ctx.scale(unit, unit);
    ctx.fillStyle = content.background ?? palette.paper; ctx.fillRect(0, 0, width, height);
    const inset = Math.min(width * .09, .19), usable = width - inset * 2;
    const font = (size: number, weight = 500): void => { ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`; };
    const text = (value: string, y: number, size: number, color = content.foreground ?? palette.ink, weight = 500): void => {
      font(size, weight); ctx.fillStyle = color; ctx.textBaseline = "middle"; ctx.fillText(value, inset, y, usable);
    };
    const compact = content.compact ?? height < .8;
    let y = inset + (compact ? .025 : .045);
    if (content.eyebrow) { text(content.eyebrow, y, compact ? .085 : .105, palette.muted); y += compact ? .15 : .22; }
    text(content.title, y, compact ? .125 : Math.min(.21, width * .125), content.foreground ?? palette.ink, 650); y += compact ? .19 : .27;
    if (content.subtitle) { text(content.subtitle, y, compact ? .085 : .105, palette.muted); y += .25; }
    const denseRows = (content.rows?.length ?? 0) > 3;
    for (const [index, row] of (content.rows ?? []).entries()) {
      ctx.fillStyle = palette.screen; ctx.beginPath(); ctx.roundRect(inset, y - .09, usable, denseRows ? .23 : .28, .055); ctx.fill();
      ctx.fillStyle = palette.accent; ctx.beginPath(); ctx.arc(inset + .095, y + .045, content.completed && index === 0 ? .055 : .027, 0, Math.PI * 2); ctx.fill();
      if (content.completed && index === 0) { ctx.strokeStyle = palette.accentInk; ctx.lineWidth = .013; ctx.beginPath(); ctx.moveTo(inset + .069, y + .046); ctx.lineTo(inset + .09, y + .064); ctx.lineTo(inset + .126, y + .025); ctx.stroke(); }
      font(denseRows ? .102 : .105, 500); ctx.fillStyle = palette.ink; ctx.fillText(row, inset + .18, y + .045, usable - .23); y += denseRows ? .27 : .37;
    }
    if (content.badge) {
      ctx.fillStyle = palette.accent; ctx.beginPath(); ctx.roundRect(inset, height - .32, usable, .19, .07); ctx.fill();
      font(.09, 600); ctx.fillStyle = palette.accentInk; ctx.textAlign = "center"; ctx.fillText(content.badge, width / 2, height - .225, usable - .1);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; textures.add(texture);
    // Display pixels emit their own colour; the surrounding glass/frame still
    // receives physical light. Paper stays lit, with a matte, low-specular face.
    const surface = content.display
      ? new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
      : material(palette.paper, { color: new THREE.Color(1, 1, 1), map: texture, roughness: .76, metalness: 0, clearcoat: 0, specularIntensity: .15 });
    materials.add(surface);
    return roundedFace(width, height, Math.min(.1, height / 6), surface);
  }
  function card(width: number, height: number, content: FaceContent, name: string, depth = .065, afterContent?: FaceContent): THREE.Group {
    const result = new THREE.Group(); result.name = name;
    result.add(plate(width, height, depth, .085, paper));
    const front = canvasFace(width - .025, height - .025, content); front.position.z = depth / 2 + .002; result.add(front);
    if (afterContent) { const afterFace = canvasFace(width - .025, height - .025, afterContent); afterFace.position.copy(front.position); result.add(afterFace); updateFaces.push(p => { front.visible = p < .6; afterFace.visible = p >= .6; }); }
    const rear = plate(width - .018, height - .018, .015, .075, ceramic); rear.position.z = -depth / 2; result.add(rear);
    return result;
  }
  function phone(name: string, receiver = false, screenOverride?: { before: FaceContent; after?: FaceContent }): THREE.Group {
    const result = new THREE.Group(); result.name = name;
    const rearSurface = receiver ? material(palette.glass, { metalness: .35, roughness: .27, clearcoat: .75, clearcoatRoughness: .18 }) : ceramic;
    // A machined frame, ceramic back and glass display have separate thicknesses.
    result.add(plate(1.28, 2.58, .16, .17, aluminium, `${name}-frame`));
    const back = plate(1.23, 2.53, .055, .16, rearSurface, `${name}-back`); back.position.z = -.073; result.add(back);
    const display = plate(1.21, 2.5, .045, .155, glass, `${name}-glass`); display.position.z = .082; result.add(display);
    const screenContent: FaceContent = screenOverride?.before ?? { eyebrow: receiver ? "接收方" : "传送方", title: receiver ? "开启接收" : "准备内容", subtitle: "OneTHU · 内容接力", rows: receiver ? ["等待设备靠近"] : ["课程资料", "一段文字", "项目文件"], badge: receiver ? "等待接收" : "3 项内容已准备" };
    const screenAfter: FaceContent | undefined = screenOverride?.after ?? (receiver ? { ...screenContent, title: "收到内容", rows: ["课程资料", "一段文字", "项目文件"], badge: "3 项内容已就位" } : undefined);
    const screen = canvasFace(1.12, 2.37, { ...screenContent, background: palette.screen, display: true });
    screen.name = `${name}-screen`; screen.position.set(0, -.015, .109); result.add(screen);
    if (screenAfter) { const afterFace = canvasFace(1.12, 2.37, { ...screenAfter, background: palette.screen, display: true }); afterFace.name = `${name}-screen-after`; afterFace.position.copy(screen.position); result.add(afterFace); updateFaces.push(p => { screen.visible = p < .6; afterFace.visible = p >= .6; }); }
    const reflection = roundedFace(1.12, 2.37, .1, material(palette.paper, { transparent: true, opacity: .025, depthWrite: false, metalness: 0, roughness: .15, clearcoat: .5, clearcoatRoughness: .14, specularIntensity: .25, envMapIntensity: .35 }));
    reflection.name = `${name}-screen-reflection`; reflection.position.set(0, -.015, .112); reflection.castShadow = false; reflection.receiveShadow = false; reflection.userData.studioGlassOverlay = true; result.add(reflection);
    const island = solid(.34, .075, .018, .008, ink, `${name}-front-camera`); island.position.set(0, 1.135, .123); result.add(island);
    const home = solid(.34, .025, .008, .003, aluminium); home.position.set(0, -1.17, .123); result.add(home);
    const bump = plate(.62, .76, .07, .13, rearSurface, `${name}-camera-island`); bump.position.set(.235, .81, -.13); result.add(bump);
    for (const [x, y] of [[.11, .98], [.35, .72]] as const) {
      const ring = new THREE.Mesh(keepGeometry(new THREE.TorusGeometry(.119, .018, 12, 32)), aluminium); ring.position.set(x, y, -.18); ring.castShadow = true; result.add(ring);
      const barrel = new THREE.Mesh(keepGeometry(new THREE.CylinderGeometry(.105, .105, .042, 32)), ink); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, y, -.185); result.add(barrel);
      const lens = new THREE.Mesh(keepGeometry(new THREE.SphereGeometry(.084, 24, 12)), glass); lens.scale.z = .18; lens.position.set(x, y, -.214); lens.name = `${name}-lens`; result.add(lens);
    }
    const flash = new THREE.Mesh(keepGeometry(new THREE.CircleGeometry(.038, 24)), paper); flash.rotation.y = Math.PI; flash.position.set(.4, 1.02, -.168); result.add(flash);
    for (const [y, length] of [[.45, .23], [.08, .33]] as const) { const button = solid(.035, length, .07, .016, aluminium); button.position.set(-.65, y, 0); result.add(button); }
    const power = solid(.035, .36, .07, .016, aluminium); power.position.set(.65, .3, 0); result.add(power);
    const mark = canvasFace(.83, .22, { title: "OneTHU", background: receiver ? palette.glass : palette.body, foreground: receiver ? palette.muted : palette.ink, compact: true }); mark.rotation.y = Math.PI; mark.position.set(0, -.17, -.105); result.add(mark);
    return result;
  }
  let applyPose: (progress: number) => void;
  if (lesson === "nfc") {
    const sender = phone("studio-phone-sender"), receiver = phone("studio-phone-receiver", true); group.add(sender, receiver);
    applyPose = progress => {
      const p = clamp(progress);
      sender.position.set(mix(-1.4, -.9, p), mix(.08, .03, p), mix(-.08, .15, p));
      receiver.position.set(mix(1.4, .9, p), mix(-.08, -.03, p), mix(.08, -.05, p));
      sender.rotation.set(mix(-.12, -.04, p), mix(2.42, .24, p), mix(-.13, .035, p));
      receiver.rotation.set(mix(.1, -.04, p), mix(-2.42, -.24, p), mix(.13, -.035, p));
    };
  } else if (lesson === "board" || lesson === "mode-full") {
    const tablet = new THREE.Group(); tablet.name = "studio-board-tablet";
    tablet.add(plate(4.15, 2.6, .16, .2, aluminium));
    const bezel = plate(4.06, 2.51, .04, .18, glass); bezel.position.z = .085; tablet.add(bezel);
    const face = canvasFace(3.91, 2.37, { eyebrow: "OneTHU", title: "首页", background: palette.screen, display: true }); face.position.z = .108; tablet.add(face); group.add(tablet);
    const todo = card(1.75, 1.57, { eyebrow: "今日待办", title: "完成课程作业", rows: ["整理一份资料", "准备课堂讨论"] }, "studio-board-card-todo");
    const note = card(1.47, .95, { eyebrow: "便笺", title: "记下刚想到的事", background: palette.note }, "studio-board-card-note");
    const course = card(1.47, .58, { eyebrow: "下一节课", title: "14:00 · 教学楼", compact: true }, "studio-board-card-course");
    group.add(todo, note, course);
    applyPose = progress => {
      const p = clamp(progress); tablet.rotation.set(mix(.08, -.025, p), mix(-.13, -.035, p), mix(-.025, 0, p));
      todo.position.set(mix(-.44, -.95, p), mix(-.08, -.19, p), mix(.45, .2, p)); todo.rotation.set(.04 * (1 - p), mix(.24, 0, p), mix(-.11, 0, p));
      note.position.set(mix(.37, .86, p), mix(.16, .12, p), mix(.81, .22, p)); note.rotation.set(mix(-.1, 0, p), mix(-.35, 0, p), mix(.13, 0, p));
      course.position.set(mix(.38, .86, p), mix(-.58, -.7, p), mix(.62, .22, p)); course.rotation.set(mix(.13, 0, p), mix(-.17, 0, p), mix(-.11, 0, p));
    };
  } else if (lesson === "organization") {
    const identity = card(3.25, 1.23, { eyebrow: "名片与组织绑定", title: "同学工作室", subtitle: "成员 · 文件 · 项目 · 公告" }, "studio-org-identity", .11);
    group.add(identity);
    const members = ["负责人", "协作者", "查看者"].map((title, index) => {
      const member = card(1.3, .98, { eyebrow: ["林同学", "周同学", "陈同学"][index], title, subtitle: ["组织管理", "共同编辑", "阅读资料"][index] }, `studio-org-member-${index}`, .075); group.add(member); return member;
    });
    applyPose = progress => {
      const p = clamp(progress); identity.position.set(0, mix(.36, .66, p), mix(.12, -.04, p)); identity.rotation.set(mix(-.07, .015, p), mix(-.18, -.04, p), mix(-.04, 0, p));
      members.forEach((member, index) => {
        const side = index - 1; member.position.set(mix(side * .10, side * 1.43, p), mix(-.48, index === 1 ? -.57 : -.72, p), mix(.28 + index * .09, index === 1 ? .34 : .15, p));
        member.rotation.set(mix(.08, -.035, p), mix(Math.PI, side * -.11, p), mix(side * .12, side * -.08, p));
      });
    };
  } else if (lesson === "code") {
    const source = card(1.35, 1.85, { eyebrow: "我的内容", title: "一组内容", rows: ["课程资料", "项目文件"], badge: "3 项" }, "studio-code-source"); source.position.set(-1.55, 0, -.05); source.rotation.y = .2;
    const key = card(1.28, .67, { eyebrow: "演示短口令", title: "ON · 7K2P", compact: true }, "studio-code-key", .09); key.position.set(0, .02, .12);
    const recipient = card(1.45, 1.95, { eyebrow: "接收方", title: "已接收", rows: ["课程资料", "项目文件"], badge: "3 项内容" }, "studio-code-recipient", .12); group.add(source, key, recipient);
    applyPose = progress => { const p = clamp(progress); recipient.position.set(mix(1.56, 1.54, p), mix(.12, 0, p), mix(-.13, .18, p)); recipient.rotation.set(mix(.08, -.035, p), mix(-Math.PI * .92, -.16, p), mix(.07, 0, p)); key.rotation.set(0, mix(-.12, .025, p), 0); };
  } else if (lesson === "vault") {
    const box = new THREE.Group(); box.name = "studio-vault-body"; box.position.set(1.13, -.25, -.12); box.rotation.set(.09, -.27, 0); group.add(box);
    const boxSurface = material(palette.body, { metalness: .12, roughness: .37, clearcoat: .35 });
    const base = solid(1.7, .09, 1.2, .04, boxSurface); base.position.y = -.65; box.add(base);
    for (const side of [-1, 1]) { const wall = solid(.085, 1.3, 1.2, .038, boxSurface); wall.position.x = side * .81; box.add(wall); }
    for (const side of [-1, 1]) { const wall = solid(1.7, 1.3, .085, .038, boxSurface); wall.position.z = side * .56; box.add(wall); }
    const label = canvasFace(1.28, .5, { title: "暂存箱", subtitle: "内容留存 · 按需分享", compact: true, background: palette.body }); label.position.set(0, .08, .605); box.add(label);
    const handle = solid(.48, .06, .07, .025, aluminium); handle.position.set(0, -.26, .64); box.add(handle);
    const lidPivot = new THREE.Group(); lidPivot.name = "studio-vault-lid"; lidPivot.position.set(0, .67, -.59);
    const lid = solid(1.76, .09, 1.25, .042, boxSurface); lid.position.z = .59; lidPivot.add(lid); box.add(lidPivot);
    const originals = ["课程资料", "一段文字", "项目文件"].map((title, index) => {
      const item = card(1.66, .51, { eyebrow: `0${index + 1}`, title, compact: true }, `studio-vault-original-${index}`); item.position.set(-1.34, .46 - index * .53, .05 + index * .035); item.rotation.set(.02, .12, index === 1 ? .045 : -.045); group.add(item); return item;
    });
    const parcels = originals.map((_, index) => { const item = card(.65, .4, { title: "资料", compact: true }, `studio-vault-parcel-${index}`, .035); group.add(item); return item; });
    applyPose = progress => {
      const p = clamp(progress); lidPivot.rotation.x = mix(0, -1.68, clamp(p * 2.1));
      parcels.forEach((parcel, index) => { const t = clamp((p - index * .11) / .76); parcel.visible = p > index * .11 && t < 1; parcel.position.set(mix(-1.34, 1.13, t), mix(.46 - index * .53, -.36, t) + Math.sin(t * Math.PI) * 1.75, mix(.25, -.03, t)); parcel.rotation.set(-t * .8, -.3 + t * .5, -.1 + Math.sin(t * Math.PI) * .25); });
    };
  } else {
    const isExtra = ["explorer", "onego", "plugin", "customize", "campus", "data"].includes(lesson);
    const titles: Record<string, string> = { explorer: "保存一组正在进行的事", onego: "从 OneGO! 接着做", plugin: "按需要扩展能力", customize: "换成习惯的样子", campus: "校园服务", data: "换台设备继续使用" };
    const today: FaceContent = { eyebrow: "OneTHU", title: "今天", subtitle: "待办与课程，一眼看到", rows: ["整理课程笔记", "14:00 下一节课"], badge: "首页 · OH 搜索" };
    const todayDone: FaceContent = { ...today, rows: ["课程笔记已完成", "14:00 下一节课"], completed: true, badge: "一件一件，轻松完成" };
    let screenBefore = today, screenAfter = lesson === "today" ? todayDone : today;
    if (lesson === "quick") { screenBefore = { eyebrow: "OneShot", title: "五个快捷入口", subtitle: "需要什么，直接点", rows: ["学习", "预约", "生活", "信息", "课表"] }; screenAfter = { eyebrow: "课表", title: "今天的课程", subtitle: "快捷入口始终在", rows: ["14:00 下一节课", "教学楼 · 提前出发"], badge: "学习 预约 生活 信息 课表" }; }
    else if (lesson === "more" || lesson === "mode-practical") { screenBefore = lesson === "more" ? { ...today, badge: "更多功能" } : today; screenAfter = { eyebrow: "更多功能", title: "服务目录", subtitle: "按目录找到服务", rows: ["课程与作业", "场馆与研讨间", "校园生活", "云盘与邮箱"] }; }
    else if (lesson === "swap") { screenBefore = { eyebrow: "常用入口", title: "安排快捷入口", subtitle: "第一格目前是学习", rows: ["学习", "预约", "生活", "课表"] }; screenAfter = { ...screenBefore, subtitle: "第一格换成云盘", rows: ["云盘", "预约", "生活", "课表"] }; }
    else if (isExtra) { screenBefore = { eyebrow: "继续探索", title: titles[lesson]!, subtitle: "按需要打开", rows: lesson === "customize" ? ["主题与壁纸", "字号与入口"] : lesson === "data" ? ["同步日程", "导出与恢复"] : ["首页与搜索", "相关功能入口"] }; screenAfter = screenBefore; }
    const device = phone("studio-phone-preview", false, { before: screenBefore, after: screenAfter }); device.position.set(-1.1, 0, -.1); group.add(device);
    const title = isExtra ? titles[lesson]! : lesson === "more" ? "更多功能" : lesson === "swap" ? "调整快捷入口" : lesson === "quick" ? "学习 预约 生活 信息 课表" : "今天，从这一件开始";
    const mainContent: FaceContent = { eyebrow: isExtra ? "继续探索" : "OneTHU", title, subtitle: isExtra ? "按需要打开，内容一直保留" : lesson === "more" ? "校园服务，按目录查找" : lesson === "quick" ? "五个入口，随时回到需要的功能" : "整理课程笔记 · 今日待办" };
    const main = card(2.1, 1.13, mainContent, "studio-preview-main", .085, lesson === "today" ? { ...mainContent, title: "课程笔记已完成", subtitle: "今日待办完成 1 项", badge: "已完成" } : undefined);
    const secondary = card(2.1, .7, { eyebrow: lesson === "swap" ? "第一格快捷入口" : "下一节课程", title: lesson === "swap" ? "学习" : "14:00 · 教学楼", compact: true }, "studio-preview-secondary", .065, lesson === "swap" ? { eyebrow: "第一格快捷入口", title: "云盘", compact: true } : undefined); group.add(main, secondary);
    applyPose = progress => { const p = clamp(progress); device.rotation.set(-.035, mix(-.32, .12, p), mix(-.055, -.015, p)); main.position.set(mix(.7, 1.12, p), mix(.12, .45, p), mix(.32, .15, p)); main.rotation.set(.02, mix(-.24, -.08, p), mix(.06, 0, p)); secondary.position.set(mix(.76, 1.12, p), mix(-.34, -.6, p), mix(.48, .22, p)); secondary.rotation.set(-.02, mix(.12, -.08, p), mix(-.075, 0, p)); };
  }
  group.userData.studioLesson = lesson;
  const pose = (progress: number): void => { const p = clamp(progress); applyPose(p); for (const update of updateFaces) update(p); };
  pose(0);
  let disposed = false;
  return {
    group,
    pose,
    dispose(): void {
      if (disposed) return; disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const surface of materials) surface.dispose();
      for (const texture of textures) texture.dispose();
      group.clear();
    },
  };
}
