import { t as i18n } from "../i18n/index.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createPhoneFace, createPhoneSlab, fitPhoneScreen, IPHONE_18_PRO } from "./tourPhoneGeometry.js";
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
  const aluminium = material(palette.edge, { metalness: .68, roughness: .3, clearcoat: .25, envMapIntensity: 1.15 });
  const ceramic = material(palette.body, { metalness: .16, roughness: .28, clearcoat: .8, clearcoatRoughness: .18 });
  const paper = material(palette.paper, { roughness: .62, metalness: 0 });
  const glass = material(palette.glass, { metalness: .18, roughness: .12, clearcoat: 1, clearcoatRoughness: .08 });
  const ink = material(palette.ink, { metalness: .12, roughness: .26 });
  // Front Ceramic Shield 2 reads as deep black glass, not a grey picture frame.
  const frontGlass = material(palette.ink, { metalness: .22, roughness: .05, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: .6 });
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
    const face = radius > 0 ? roundedFace(width, height, radius, surface) : new THREE.Mesh(keepGeometry(new THREE.PlaneGeometry(width, height)), surface);
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
    const { width, height, depth, corner, bevel, displayWidth, displayHeight, glassCorner } = IPHONE_18_PRO;
    // iPhone 18 Pro: forged aluminium unibody, Ceramic Shield 2 front, Ceramic Shield back.
    // One continuous G2 outline keeps the corners round even though the frame is thin.
    const frame = new THREE.Mesh(keepGeometry(createPhoneSlab(width, height, depth, corner, bevel)), aluminium);
    frame.name = `${name}-frame`; frame.castShadow = true; frame.receiveShadow = true; result.add(frame);
    const back = new THREE.Mesh(keepGeometry(createPhoneFace(width - .038, height - .038, corner - .002)), rearSurface);
    back.name = `${name}-back`; back.position.z = -depth / 2 - .001; back.rotation.y = Math.PI; back.receiveShadow = true; result.add(back);
    // Contain the entire capture in the physical panel; never stretch it. Only the
    // display's rounded outline masks the extreme corners.
    const displayFit = fitPhoneScreen(displayWidth, displayHeight);
    const glassWidth = displayFit.width + .023, glassHeight = displayFit.height + .023;
    // Cover glass hugs the capture, so the visible metal is the slab's chamfer
    // rather than a wide painted frame. It stays inside the slab's front cap.
    const display = new THREE.Mesh(keepGeometry(createPhoneFace(glassWidth, glassHeight, glassCorner)), frontGlass);
    display.name = `${name}-glass`; display.position.z = depth / 2 + .001; display.receiveShadow = true; result.add(display);
    const before = selectStudioScreen(lesson, mode, false), after = selectStudioScreen(lesson, mode, true);
    const beforeKey = (receiver ? before.secondary : before.primary)?.key;
    const afterKey = (receiver ? after.secondary : after.primary)?.key;
    if (!beforeKey || !afterKey) throw new Error(i18n("components.tourstudiomodels.cf4324a5411f"));
    const screen = screenshotFace(beforeKey, displayFit.width, displayFit.height, IPHONE_18_PRO.displayCorner); screen.name = `${name}-screen`; screen.position.set(displayFit.x, displayFit.y, depth / 2 + .0016); result.add(screen);
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
      const afterFace = screenshotFace(afterKey, displayFit.width, displayFit.height, IPHONE_18_PRO.displayCorner); afterFace.name = `${name}-screen-after`; afterFace.position.copy(screen.position); result.add(afterFace);
      updateFaces.push(p => { screen.visible = p < .9; afterFace.visible = p >= .9; });
    }
    const reflection = roundedFace(displayWidth, displayHeight, glassCorner - .02, material(palette.paper, { transparent: true, opacity: .03, depthWrite: false, metalness: 0, roughness: .12, clearcoat: .6, clearcoatRoughness: .1, specularIntensity: .3, envMapIntensity: .4 }));
    reflection.name = `${name}-screen-reflection`; reflection.position.set(0, 0, depth / 2 + .0026); reflection.castShadow = false; reflection.receiveShadow = false; reflection.userData.studioGlassOverlay = true; result.add(reflection);
    // The front sensor stays on the bezel so the captured application UI is never covered.
    const island = solid(IPHONE_18_PRO.islandWidth, IPHONE_18_PRO.islandHeight, .006, IPHONE_18_PRO.islandHeight / 2, ink, `${name}-front-camera`);
    island.position.set(0, IPHONE_18_PRO.islandY, depth / 2 + .0022); result.add(island);
    const plateau = new THREE.Mesh(keepGeometry(createPhoneSlab(IPHONE_18_PRO.plateauWidth, IPHONE_18_PRO.plateauHeight, .06, .19, .012)), rearSurface);
    plateau.name = `${name}-camera-plateau`; plateau.position.set(IPHONE_18_PRO.plateauX, IPHONE_18_PRO.plateauY, -depth / 2 - .028); plateau.castShadow = true; plateau.receiveShadow = true; result.add(plateau);
    const lensGlass = material(palette.glass, { metalness: .4, roughness: .06, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.3 });
    const lens = (lx: number, ly: number, radius: number, label: string): THREE.Group => {
      const assembly = new THREE.Group(); assembly.name = `${name}-lens-${label}`; assembly.position.set(lx, ly, -depth / 2 - .06);
      const ring = new THREE.Mesh(keepGeometry(new THREE.TorusGeometry(radius, .016, 16, 48)), aluminium); ring.castShadow = true; assembly.add(ring);
      const housing = new THREE.Mesh(keepGeometry(new THREE.CylinderGeometry(radius - .004, radius - .002, .03, 48)), ink); housing.rotation.x = Math.PI / 2; housing.position.z = .012; assembly.add(housing);
      const barrel = new THREE.Mesh(keepGeometry(new THREE.CylinderGeometry(radius * .66, radius * .7, .012, 48)), glass); barrel.rotation.x = Math.PI / 2; barrel.position.z = -.004; assembly.add(barrel);
      const element = new THREE.Mesh(keepGeometry(new THREE.SphereGeometry(radius * .54, 32, 16)), lensGlass); element.scale.z = .32; element.position.z = -.012; element.name = `${name}-lens-element`; assembly.add(element);
      const rim = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(radius * .62, radius * .74, 48)), ink); rim.rotation.y = Math.PI; rim.position.z = -.016; assembly.add(rim);
      return assembly;
    };
    for (const [lx, ly, label] of [
      [IPHONE_18_PRO.plateauX - .145, IPHONE_18_PRO.plateauY + .145, "main"],
      [IPHONE_18_PRO.plateauX - .145, IPHONE_18_PRO.plateauY - .14, "ultra"],
      [IPHONE_18_PRO.plateauX + .145, IPHONE_18_PRO.plateauY + .005, "tele"],
    ] as const) result.add(lens(lx, ly, .104, label));
    const flashRing = new THREE.Mesh(keepGeometry(new THREE.TorusGeometry(.046, .008, 12, 32)), aluminium); flashRing.position.set(.1, 1.02, -depth / 2 - .003); result.add(flashRing);
    const flash = new THREE.Mesh(keepGeometry(new THREE.CircleGeometry(.042, 32)), paper); flash.rotation.y = Math.PI; flash.position.set(.1, 1.02, -depth / 2 - .005); result.add(flash);
    const micro = new THREE.Mesh(keepGeometry(new THREE.CircleGeometry(.017, 20)), ink); micro.rotation.y = Math.PI; micro.position.set(.1, .9, -depth / 2 - .004); result.add(micro);
    // Physical controls: Action button and volume pair on the left, side button and Camera Control on the right.
    const side = width / 2 - .008;
    for (const [y, length, label] of [[.79, .10, "action"], [.55, .20, "volume-up"], [.31, .20, "volume-down"]] as const) { const button = solid(.03, length, .062, .013, aluminium, `${name}-${label}`); button.position.set(-side, y, 0); result.add(button); }
    const power = solid(.03, .26, .062, .013, aluminium, `${name}-side-button`); power.position.set(side, .55, 0); result.add(power);
    const cameraControl = solid(.022, .12, .05, .009, glass, `${name}-camera-control`); cameraControl.position.set(side + .002, -.02, 0); result.add(cameraControl);
    const port = solid(.11, .014, .042, .006, ink, `${name}-usb-c`); port.position.set(0, -height / 2 + .004, 0); result.add(port);
    for (let index = 0; index < 6; index++) for (const direction of [-1, 1]) {
      const hole = new THREE.Mesh(keepGeometry(new THREE.CylinderGeometry(.0055, .0055, .012, 14)), ink);
      hole.position.set(direction * (.1 + index * .026), -height / 2 + .004, 0); result.add(hole);
    }
    return result;
  }
  let applyPose: (progress: number) => void;
  /* The studio camera looks slightly down at the scene. Lean the screens up
     toward the viewer (仰角) so a model never starts facing the floor; the
     settled angle keeps the same reading direction. */
  const FACE_VIEWER = -.16;
  const READING_ANGLE = -.08;
  if (lesson === "nfc") {
    const sender = phone("studio-phone-sender"), receiver = phone("studio-phone-receiver", true); group.add(sender, receiver);
    applyPose = progress => {
      const p = clamp(progress);
      sender.position.set(mix(-1.4, -.9, p), mix(.08, .03, p), mix(-.08, .15, p));
      receiver.position.set(mix(1.4, .9, p), mix(-.08, -.03, p), mix(.08, -.05, p));
      sender.rotation.set(mix(FACE_VIEWER, READING_ANGLE, p), mix(2.42, .24, p), mix(-.13, .035, p));
      receiver.rotation.set(mix(FACE_VIEWER, READING_ANGLE, p), mix(-2.42, -.24, p), mix(.13, -.035, p));
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
      tablet.rotation.set(mix(FACE_VIEWER, READING_ANGLE, p), mix(-.25, .035, p), mix(-.04, 0, p));
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
        member.rotation.set(mix(FACE_VIEWER, READING_ANGLE, p), mix(Math.PI, side * -.11, p), mix(side * .12, side * -.08, p));
      });
    };
  } else if (lesson === "code") {
    const source = card(1.35, 1.85, { eyebrow: i18n("components.tourstudiomodels.90c7cebe15c6"), title: i18n("components.tourstudiomodels.d38b22e68fc1"), rows: [i18n("components.tourstudiomodels.28d76cd105cb"), i18n("components.tourstudiomodels.07e577ff8c0d")], badge: i18n("components.tourstudiomodels.49ef840efe6f") }, "studio-code-source"); source.position.set(-1.55, 0, -.05); source.rotation.y = .2;
    const key = card(1.28, .67, { eyebrow: i18n("components.tourstudiomodels.b0c8602734bb"), title: "ON · 7K2P", compact: true }, "studio-code-key", .09); key.position.set(0, .02, .12);
    const recipient = card(1.45, 1.95, { eyebrow: i18n("components.tourstudiomodels.d513aac3caac"), title: i18n("components.tourstudiomodels.92f20b9fa474"), rows: [i18n("components.tourstudiomodels.28d76cd105cb"), i18n("components.tourstudiomodels.07e577ff8c0d")], badge: i18n("components.tourstudiomodels.21c80015e886") }, "studio-code-recipient", .12); group.add(source, key, recipient);
    applyPose = progress => { const p = clamp(progress); recipient.position.set(mix(1.56, 1.54, p), mix(.12, 0, p), mix(-.13, .18, p)); recipient.rotation.set(mix(FACE_VIEWER, READING_ANGLE, p), mix(-Math.PI * .92, -.16, p), mix(.07, 0, p)); key.rotation.set(0, mix(-.12, .025, p), 0); };
  } else {
    const device = phone("studio-phone-preview"); group.add(device);
    applyPose = progress => {
      const p = clamp(progress);
      device.position.set(0, mix(-.02, .02, p), 0);
      device.rotation.set(READING_ANGLE, mix(-.32, .12, p), mix(-.055, -.015, p));
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
