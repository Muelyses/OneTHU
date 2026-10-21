import { t as i18n } from "../i18n/index.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { selectStudioScreen, studioVaultVideo, type StudioScreenAssets, type StudioScreenKey } from "./tourStudioScreens.js";

/** Resolved OneGUI material colours. Each assembly owns and disposes its resources. */
export interface StudioPalette {
  body: string; edge: string; glass: string; screen: string; ink: string;
  muted: string; paper: string; accent: string; accentInk: string; note: string;
}
export interface StudioAssembly {
  group: THREE.Group;
  pose(progress: number): void;
  dispose(): void;
  setPlaying?(running: boolean, reduced: boolean): void;
}
interface FaceContent {
  eyebrow?: string; title: string; subtitle?: string; rows?: string[];
  badge?: string; background?: string; compact?: boolean; display?: boolean; completed?: boolean; foreground?: string;
}
const mix = THREE.MathUtils.lerp;
const clamp = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);

/** Real bevelled solids under every face; canvas textures contain only typography/UI. */
export function createStudioAssembly(lesson: string, palette: StudioPalette, mode: "simple" | "practical" | "full" = "full", screens?: StudioScreenAssets, onFrame?: () => void): StudioAssembly {
  if (!["organization", "code", "vault"].includes(lesson)) {
    for (const after of [false, true]) {
      const selection = selectStudioScreen(lesson, mode, after);
      for (const source of [selection.primary, selection.secondary]) {
        if (!source) continue;
        const image = screens?.[source.key];
        if (!image?.complete || !image.naturalWidth || !image.naturalHeight) throw new Error(i18n("components.tourstudiomodels.fca0380c4f7e", { key: String(source.key) }));
      }
    }
  }
  const group = new THREE.Group(); group.name = `studio-assembly-${lesson}`;
  const updateFaces: Array<(progress: number) => void> = [];
  let setPlaying: StudioAssembly["setPlaying"], releaseMedia: (() => void) | undefined;
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
  const screenMaterials = new Map<StudioScreenKey, THREE.MeshBasicMaterial>();
  function screenshotFace(key: StudioScreenKey, maxWidth = 1.16, maxHeight = 2.51, radius = .075): THREE.Mesh {
    const image = screens?.[key];
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) throw new Error(i18n("components.tourstudiomodels.fca0380c4f7e", { key: String(key) }));
    let surface = screenMaterials.get(key);
    if (!surface) {
      const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; texture.needsUpdate = true; textures.add(texture);
      surface = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }); materials.add(surface); screenMaterials.set(key, surface);
    }
    // Preserve the entire captured viewport. The small physical camera occupies
    // its own top margin and must not cover real app controls.
    const aspect = image.naturalWidth / image.naturalHeight;
    const width = Math.min(maxWidth, maxHeight * aspect), height = width / aspect;
    const face = roundedFace(width, height, radius, surface);
    face.userData.studioScreen = { key, url: image.currentSrc || image.src, width: image.naturalWidth, height: image.naturalHeight };
    return face;
  }
  function card(width: number, height: number, content: FaceContent, name: string, depth = .065, afterContent?: FaceContent): THREE.Group {
    const result = new THREE.Group(); result.name = name;
    result.add(plate(width, height, depth, .085, paper));
    const front = canvasFace(width - .025, height - .025, content); front.position.z = depth / 2 + .002; result.add(front);
    if (afterContent) { const afterFace = canvasFace(width - .025, height - .025, afterContent); afterFace.position.copy(front.position); result.add(afterFace); updateFaces.push(p => { front.visible = p < .6; afterFace.visible = p >= .6; }); }
    const rear = plate(width - .018, height - .018, .015, .075, ceramic); rear.position.z = -depth / 2; result.add(rear);
    return result;
  }
  function phone(name: string, receiver = false): THREE.Group {
    const result = new THREE.Group(); result.name = name;
    const rearSurface = receiver ? material(palette.glass, { metalness: .35, roughness: .27, clearcoat: .75, clearcoatRoughness: .18 }) : ceramic;
    // A machined frame, ceramic back and glass display have separate thicknesses.
    result.add(plate(1.2, 2.6, .16, .1, aluminium, `${name}-frame`));
    const back = plate(1.15, 2.55, .055, .095, rearSurface, `${name}-back`); back.position.z = -.073; result.add(back);
    const display = plate(1.18, 2.56, .045, .09, glass, `${name}-glass`); display.position.z = .082; result.add(display);
    const before = selectStudioScreen(lesson, mode, false), after = selectStudioScreen(lesson, mode, true);
    const beforeKey = (receiver ? before.secondary : before.primary)?.key;
    const afterKey = (receiver ? after.secondary : after.primary)?.key;
    if (!beforeKey || !afterKey) throw new Error(i18n("components.tourstudiomodels.cf4324a5411f"));
    const screen = screenshotFace(beforeKey); screen.name = `${name}-screen`; screen.position.set(0, 0, .109); result.add(screen);
    if (lesson === "vault" && !receiver) {
      const video = document.createElement("video");
      video.src = studioVaultVideo(); video.loop = true; video.muted = true; video.playsInline = true; video.preload = "auto";
      video.dataset.tourVaultDemo = "true";
      Object.defineProperty(group.userData, "media", { get: () => ({ kind: "recorded-drag", src: video.currentSrc || video.src, currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null, paused: video.paused }) });
      const texture = new THREE.VideoTexture(video); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
      const surface = screen.material as THREE.MeshBasicMaterial;
      const first = surface.map!, last = screenshotFace(afterKey).material as THREE.MeshBasicMaterial;
      let running = false, reduced = false, released = false, request = 0, timer = 0, progress = 0;
      const frame = (): void => {
        if (released || !running) return;
        if (video.readyState >= 2) { surface.map = texture; surface.needsUpdate = true; onFrame?.(); }
        if (typeof video.requestVideoFrameCallback === "function") request = video.requestVideoFrameCallback(frame);
        else timer = window.setTimeout(frame, 40);
      };
      setPlaying = (next, minimal) => {
        reduced = minimal;
        if (reduced) { surface.map = progress >= .9 ? last.map : first; surface.needsUpdate = true; }
        if (next === running) return;
        running = next;
        if (running) void video.play().then(frame, () => { running = false; surface.map = first; surface.needsUpdate = true; });
        else { video.pause(); if (request) video.cancelVideoFrameCallback(request); if (timer) clearTimeout(timer); }
      };
      updateFaces.push(p => { progress = p; if (reduced) { surface.map = p >= .9 ? last.map : first; surface.needsUpdate = true; } });
      releaseMedia = () => { released = true; running = false; video.pause(); if (request) video.cancelVideoFrameCallback(request); if (timer) clearTimeout(timer); video.removeAttribute("src"); video.load(); };
    } else if (afterKey !== beforeKey) {
      const afterFace = screenshotFace(afterKey); afterFace.name = `${name}-screen-after`; afterFace.position.copy(screen.position); result.add(afterFace);
      updateFaces.push(p => { screen.visible = p < .9; afterFace.visible = p >= .9; });
    }
    const reflection = roundedFace(1.16, 2.51, .075, material(palette.paper, { transparent: true, opacity: .025, depthWrite: false, metalness: 0, roughness: .15, clearcoat: .5, clearcoatRoughness: .14, specularIntensity: .25, envMapIntensity: .35 }));
    reflection.name = `${name}-screen-reflection`; reflection.position.set(0, 0, .112); reflection.castShadow = false; reflection.receiveShadow = false; reflection.userData.studioGlassOverlay = true; result.add(reflection);
    const island = solid(.16, .014, .012, .006, ink, `${name}-front-camera`); island.position.set(0, 1.275, .123); result.add(island);
    const bump = plate(.62, .76, .07, .13, rearSurface, `${name}-camera-island`); bump.position.set(.235, .81, -.13); result.add(bump);
    for (const [x, y] of [[.11, .98], [.35, .72]] as const) {
      const ring = new THREE.Mesh(keepGeometry(new THREE.TorusGeometry(.119, .018, 12, 32)), aluminium); ring.position.set(x, y, -.18); ring.castShadow = true; result.add(ring);
      const barrel = new THREE.Mesh(keepGeometry(new THREE.CylinderGeometry(.105, .105, .042, 32)), ink); barrel.rotation.x = Math.PI / 2; barrel.position.set(x, y, -.185); result.add(barrel);
      const lens = new THREE.Mesh(keepGeometry(new THREE.SphereGeometry(.084, 24, 12)), glass); lens.scale.z = .18; lens.position.set(x, y, -.214); lens.name = `${name}-lens`; result.add(lens);
    }
    const flash = new THREE.Mesh(keepGeometry(new THREE.CircleGeometry(.038, 24)), paper); flash.rotation.y = Math.PI; flash.position.set(.4, 1.02, -.168); result.add(flash);
    for (const [y, length] of [[.45, .23], [.08, .33]] as const) { const button = solid(.035, length, .07, .016, aluminium); button.position.set(-.61, y, 0); result.add(button); }
    const power = solid(.035, .36, .07, .016, aluminium); power.position.set(.61, .3, 0); result.add(power);
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
    const face = screenshotFace("board-full", 3.91, 2.37, .1);
    face.name = "studio-board-screen"; face.position.z = .108; tablet.add(face); group.add(tablet);
    applyPose = progress => {
      const p = clamp(progress);
      tablet.position.z = mix(-.2, .08, p);
      tablet.rotation.set(mix(.12, -.025, p), mix(-.25, .035, p), mix(-.04, 0, p));
    };
  } else if (lesson === "organization") {
    const identity = card(3.25, 1.23, { eyebrow: i18n("components.tourstudiomodels.6fef00bb252c"), title: i18n("components.tourstudiomodels.1c23243a9085"), subtitle: i18n("components.tourstudiomodels.06f8b75c9666") }, "studio-org-identity", .11);
    group.add(identity);
    const members = [i18n("components.tourstudiomodels.a525346277ed"), i18n("components.tourstudiomodels.5c05d463d109"), i18n("components.tourstudiomodels.392a69fb2ef7")].map((title, index) => {
      const member = card(1.3, .98, { eyebrow: [i18n("components.tourstudiomodels.eddeec1a4275"), i18n("components.tourstudiomodels.0a27a98a90c3"), i18n("components.tourstudiomodels.6885fcbe795c")][index], title, subtitle: [i18n("components.tourstudiomodels.dde28d3ac66c"), i18n("components.tourstudiomodels.80b6a54ddb31"), i18n("components.tourstudiomodels.7edb884bee96")][index] }, `studio-org-member-${index}`, .075); group.add(member); return member;
    });
    applyPose = progress => {
      const p = clamp(progress); identity.position.set(0, mix(.36, .66, p), mix(.12, -.04, p)); identity.rotation.set(mix(-.07, .015, p), mix(-.18, -.04, p), mix(-.04, 0, p));
      members.forEach((member, index) => {
        const side = index - 1; member.position.set(mix(side * .10, side * 1.43, p), mix(-.48, index === 1 ? -.57 : -.72, p), mix(.28 + index * .09, index === 1 ? .34 : .15, p));
        member.rotation.set(mix(.08, -.035, p), mix(Math.PI, side * -.11, p), mix(side * .12, side * -.08, p));
      });
    };
  } else if (lesson === "code") {
    const source = card(1.35, 1.85, { eyebrow: i18n("components.tourstudiomodels.90c7cebe15c6"), title: i18n("components.tourstudiomodels.d38b22e68fc1"), rows: [i18n("components.tourstudiomodels.28d76cd105cb"), i18n("components.tourstudiomodels.07e577ff8c0d")], badge: i18n("components.tourstudiomodels.49ef840efe6f") }, "studio-code-source"); source.position.set(-1.55, 0, -.05); source.rotation.y = .2;
    const key = card(1.28, .67, { eyebrow: i18n("components.tourstudiomodels.b0c8602734bb"), title: "ON · 7K2P", compact: true }, "studio-code-key", .09); key.position.set(0, .02, .12);
    const recipient = card(1.45, 1.95, { eyebrow: i18n("components.tourstudiomodels.d513aac3caac"), title: i18n("components.tourstudiomodels.92f20b9fa474"), rows: [i18n("components.tourstudiomodels.28d76cd105cb"), i18n("components.tourstudiomodels.07e577ff8c0d")], badge: i18n("components.tourstudiomodels.21c80015e886") }, "studio-code-recipient", .12); group.add(source, key, recipient);
    applyPose = progress => { const p = clamp(progress); recipient.position.set(mix(1.56, 1.54, p), mix(.12, 0, p), mix(-.13, .18, p)); recipient.rotation.set(mix(.08, -.035, p), mix(-Math.PI * .92, -.16, p), mix(.07, 0, p)); key.rotation.set(0, mix(-.12, .025, p), 0); };
  } else {
    const device = phone("studio-phone-preview"); group.add(device);
    applyPose = progress => {
      const p = clamp(progress);
      device.position.set(0, mix(-.02, .02, p), 0);
      device.rotation.set(-.035, mix(-.32, .12, p), mix(-.055, -.015, p));
    };
  }
  group.userData.studioLesson = lesson;
  const pose = (progress: number): void => { const p = clamp(progress); applyPose(p); for (const update of updateFaces) update(p); };
  pose(0);
  let disposed = false;
  return {
    group,
    pose,
    setPlaying,
    dispose(): void {
      if (disposed) return; disposed = true;
      releaseMedia?.();
      for (const geometry of geometries) geometry.dispose();
      for (const surface of materials) surface.dispose();
      for (const texture of textures) texture.dispose();
      geometries.clear(); materials.clear(); textures.clear(); screenMaterials.clear();
      group.clear();
    },
  };
}
