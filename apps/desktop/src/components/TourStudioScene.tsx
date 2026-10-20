import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createStudioAssembly, type StudioPalette } from "./tourStudioModels.js";

export interface TourStudioSceneProps {
  lesson: string;
  after: boolean;
  running: boolean;
  reduced: boolean;
  replayKey: number | string;
  fallback?: ReactNode;
  onReady?: () => void;
}
type Spring = { value: number; velocity: number; target: number };
const spring = (value: number, target = value): Spring => ({ value, velocity: 0, target });
/** Analytic critically damped motion keeps both position and velocity when the user reverses. */
function advance(value: Spring, dt: number, frequency = 6.2): boolean {
  const offset = value.value - value.target, decay = Math.exp(-frequency * dt);
  const step = (value.velocity + frequency * offset) * dt;
  value.value = value.target + (offset + step) * decay;
  value.velocity = (value.velocity - frequency * step) * decay;
  if (Math.abs(value.value - value.target) < .0015 && Math.abs(value.velocity) < .006) {
    value.value = value.target; value.velocity = 0; return false;
  }
  return true;
}
const settle = (value: Spring): void => { value.value = value.target; value.velocity = 0; };
type Assembly = ReturnType<typeof createStudioAssembly>;
type Actor = { lesson: string; assembly: Assembly; pose: Spring; weight: Spring; x: Spring; y: Spring; z: Spring; yaw: Spring; bounds: THREE.Box3 };
type StudioCanvas = HTMLCanvasElement & { __tourStudioInspect?: () => unknown };
const COLOR_ROLES: Record<keyof StudioPalette, string> = {
  body: "--og-studio-body", edge: "--og-studio-edge", glass: "--og-studio-glass", screen: "--og-studio-screen",
  ink: "--og-media-ink-dark", muted: "--og-studio-muted", paper: "--og-media-underlay", accent: "--og-studio-accent",
  accentInk: "--og-media-ink-light", note: "--og-note-paper",
};

/** A finite studio take: one renderer, PBR assemblies, softbox reflections and reversible motion. */
export function TourStudioScene(props: TourStudioSceneProps) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<StudioCanvas>(null);
  const runtime = useRef<{ update: (next: TourStudioSceneProps) => void; paint: () => void } | null>(null);
  const [available, setAvailable] = useState(false);
  useLayoutEffect(() => {
    const element = host.current!, surface = canvas.current!;
    let config = props, disposed = false, lost = false, visible = true, raf = 0, lastTime = 0;
    let width = 1, height = 1, frames = 0, settled = false, readyReported = false, presented = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: surface, alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      element.dataset.renderer = "fallback"; element.dataset.contextState = "unavailable";
      element.dataset.settled = "true"; setAvailable(false); return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
    renderer.setClearAlpha(0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, .1, 60);
    const actors: Actor[] = [];
    let palette!: StudioPalette, paletteKey = "", active: Actor;
    let environmentTarget: THREE.WebGLRenderTarget | null = null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const disposeEnvironment = (): void => { environmentTarget?.dispose(); environmentTarget = null; };
    const buildEnvironment = (): void => {
      const room = new RoomEnvironment();
      const next = pmrem.fromScene(room, .045);
      room.dispose(); environmentTarget?.dispose(); environmentTarget = next; scene.environment = next.texture;
      scene.environmentIntensity = .6;
    };
    const readPalette = (): boolean => {
      const style = getComputedStyle(element);
      const entries = Object.entries(COLOR_ROLES).map(([role, token]) => [role, style.getPropertyValue(token).trim()]);
      const key = JSON.stringify(entries);
      if (key === paletteKey) return false;
      palette = Object.fromEntries(entries) as unknown as StudioPalette; paletteKey = key; return true;
    };
    readPalette();
    const keyLight = new THREE.DirectionalLight(palette.paper, 2.2);
    keyLight.position.set(-2.5, 8, 3.5); keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024); keyLight.shadow.camera.left = -6; keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 5; keyLight.shadow.camera.bottom = -5; keyLight.shadow.camera.near = .5; keyLight.shadow.camera.far = 20;
    keyLight.shadow.bias = -.0004; keyLight.shadow.normalBias = .025; keyLight.shadow.radius = 5; keyLight.shadow.blurSamples = 8;
    const fillLight = new THREE.DirectionalLight(palette.paper, .7); fillLight.position.set(4, 2, 1);
    const rimLight = new THREE.DirectionalLight(palette.paper, 1.4); rimLight.position.set(1, 4, -4);
    scene.add(keyLight, fillLight, rimLight);
    const floorGeometry = new THREE.PlaneGeometry(18, 14), floorMaterial = new THREE.ShadowMaterial({ color: palette.ink, opacity: .09 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.65; floor.receiveShadow = true; scene.add(floor);
    const angle = spring(config.reduced ? .1 : 2.35, .1), distance = spring(8), elevation = spring(.24, .19), focusY = spring(0);
    const cameraSprings = [angle, distance, elevation, focusY];
    let take: { kind: "intro" | "replay"; phase: "pullback" | "turn"; endYaw: number } | null = null;
    const actorSprings = (actor: Actor): Spring[] => [actor.pose, actor.weight, actor.x, actor.y, actor.z, actor.yaw];
    const targetAngle = (): number => (config.after ? .24 : -.22) + (config.lesson === "nfc" ? .05 : 0);
    const applyActor = (actor: Actor): void => {
      actor.assembly.pose(THREE.MathUtils.clamp(actor.pose.value, 0, 1));
      actor.assembly.group.position.set(actor.x.value, actor.y.value, actor.z.value);
      actor.assembly.group.rotation.y = actor.yaw.value;
    };
    const removeActor = (actor: Actor): void => {
      scene.remove(actor.assembly.group); actor.assembly.dispose();
      const index = actors.indexOf(actor); if (index >= 0) actors.splice(index, 1);
    };
    const createActor = (lesson: string, first = false): Actor => {
      const assembly = createStudioAssembly(lesson, palette);
      const bounds = new THREE.Box3();
      for (const progress of [0, .25, .5, .75, 1]) {
        assembly.pose(progress); assembly.group.updateMatrixWorld(true);
        bounds.union(new THREE.Box3().setFromObject(assembly.group));
      }
      assembly.pose(0);
      assembly.group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = !object.userData.studioGlassOverlay; object.receiveShadow = !object.userData.studioGlassOverlay; } });
      const actor = { lesson, assembly, pose: spring(0, config.after ? 1 : 0), weight: spring(first ? 1 : 0, 1), x: spring(first ? 0 : 4.2, 0), y: spring(first ? 0 : -.1, 0), z: spring(first ? 0 : -1.2, 0), yaw: spring(first ? 0 : -.7, 0), bounds };
      actors.push(actor); scene.add(assembly.group); applyActor(actor); return actor;
    };
    const turnDistance = (): number => {
      const bounds = active.bounds, centerY = bounds.getCenter(new THREE.Vector3()).y;
      // Every sampled action pose fits inside this sphere through an entire Y-axis turn.
      const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.y - centerY), Math.abs(bounds.max.y - centerY)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
      const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2), halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
      return radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08;
    };
    const fitCamera = (): void => {
      if (!active || active.bounds.isEmpty()) return;
      const size = active.bounds.getSize(new THREE.Vector3()), center = active.bounds.getCenter(new THREE.Vector3());
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      // Front and reverse poses share a framing envelope, including room for action and shadows.
      distance.target = Math.max(size.y / (2 * tan), size.x / (2 * tan * camera.aspect), 3.5) * 1.22 + size.z * .55;
      if (take) distance.target = Math.max(distance.target, turnDistance());
      focusY.target = center.y;
    };
    try { buildEnvironment(); active = createActor(config.lesson, true); }
    catch {
      actors.slice().forEach(removeActor); disposeEnvironment(); pmrem.dispose(); floorGeometry.dispose(); floorMaterial.dispose(); renderer.dispose();
      element.dataset.renderer = "fallback"; element.dataset.contextState = "initialization-failed"; element.dataset.settled = "true"; setAvailable(false); return;
    }
    const isRunning = (): boolean => config.running && !config.reduced && visible && !document.hidden && width > 1 && height > 1 && !lost && !disposed;
    const report = (): void => {
      element.dataset.renderer = lost ? "fallback" : "webgl"; element.dataset.settled = String(settled);
      element.dataset.sceneLesson = active.lesson; element.dataset.running = String(isRunning()); element.dataset.frame = String(frames);
      element.dataset.contextState = lost ? "lost" : "ready";
    };
    const applyCamera = (): void => {
      const radius = distance.value, pitch = elevation.value;
      camera.position.set(Math.sin(angle.value) * radius * Math.cos(pitch), focusY.value + radius * Math.sin(pitch), Math.cos(angle.value) * radius * Math.cos(pitch));
      camera.lookAt(0, focusY.value, 0); camera.updateMatrixWorld(true);
    };
    const draw = (): void => {
      if (disposed || lost || width < 2 || height < 2 || !visible || document.hidden) return;
      actors.forEach(applyActor); applyCamera(); renderer.render(scene, camera); frames++; presented ||= isRunning(); report();
      if (!readyReported) { readyReported = true; config.onReady?.(); }
    };
    const settleScene = (): void => {
      if (take) { take = null; active.yaw.target = 0; fitCamera(); }
      cameraSprings.forEach(settle);
      for (const actor of actors.slice()) {
        if (actor !== active) removeActor(actor);
        else { actorSprings(actor).forEach(settle); applyActor(actor); }
      }
      // A hidden stage still has a final CPU pose; visibility only gates GPU drawing.
      applyCamera();
      settled = true;
    };
    const stop = (): void => { if (raf) cancelAnimationFrame(raf); raf = 0; lastTime = 0; };
    const tick = (now: number): void => {
      raf = 0;
      if (!isRunning()) { report(); return; }
      const dt = lastTime ? Math.min(.05, (now - lastTime) / 1000) : 1 / 60; lastTime = now;
      let moving = false;
      for (const value of cameraSprings) moving = advance(value, dt, value === angle ? 4.8 : 5.6) || moving;
      for (const actor of actors.slice()) {
        for (const value of actorSprings(actor)) moving = advance(value, dt) || moving;
        if (actor.yaw.value === actor.yaw.target && Math.abs(actor.yaw.value) >= Math.PI * 2) {
          actor.yaw.value %= Math.PI * 2; actor.yaw.target = actor.yaw.value;
        }
        if (actor !== active && actor.weight.value === 0) removeActor(actor);
      }
      if (take?.phase === "pullback" && distance.value >= turnDistance() * .99 && Math.abs(active.x.value) < .02) {
        active.yaw.target = take.endYaw; take.phase = "turn"; moving = true;
      } else if (take?.phase === "turn" && (take.kind === "intro" ? angle.value === angle.target : active.yaw.value === active.yaw.target)) {
        take = null; fitCamera(); moving = true;
      }
      settled = !moving; draw();
      if (moving) raf = requestAnimationFrame(tick); else lastTime = 0;
    };
    const wake = (paint = true): void => {
      if (disposed) return;
      if (!isRunning()) { stop(); settleScene(); if (paint) draw(); report(); return; }
      if (!presented) {
        for (const actor of actors.slice()) {
          if (actor !== active) removeActor(actor);
          else for (const value of [actor.weight, actor.x, actor.y, actor.z, actor.yaw]) settle(value);
        }
        take = { kind: "intro", phase: "turn", endYaw: 0 }; fitCamera();
        angle.value = 2.35; distance.value = distance.target; settle(focusY);
      }
      settled = false;
      if (paint) draw();
      if (!raf) { lastTime = 0; raf = requestAnimationFrame(tick); }
      report();
    };
    const resize = (): void => {
      width = Math.max(1, element.clientWidth); height = Math.max(1, element.clientHeight);
      const phone = matchMedia("(pointer: coarse)").matches || window.innerWidth <= 600;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, phone ? 1.5 : 1.75)); renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix(); fitCamera();
      keyLight.shadow.mapSize.set(phone ? 512 : 1024, phone ? 512 : 1024);
      keyLight.shadow.map?.dispose(); keyLight.shadow.map = null;
      wake();
    };
    const onLost = (event: Event): void => { event.preventDefault(); lost = true; stop(); setAvailable(false); report(); };
    const onRestored = (): void => {
      if (disposed) return;
      try { lost = false; buildEnvironment(); setAvailable(true); wake(); }
      catch { lost = true; setAvailable(false); report(); }
    };
    const onVisibility = (): void => { if (document.hidden) { stop(); report(); } else wake(); };
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => { const next = !!entry?.isIntersecting; if (next === visible) return; visible = next; if (!visible) { stop(); report(); } else wake(); }, { threshold: .01 });
    const theme = new MutationObserver(() => {
      if (disposed || lost || !readPalette()) return;
      for (const actor of actors) {
        scene.remove(actor.assembly.group); actor.assembly.dispose(); actor.assembly = createStudioAssembly(actor.lesson, palette);
        actor.assembly.group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = !object.userData.studioGlassOverlay; object.receiveShadow = !object.userData.studioGlassOverlay; } });
        scene.add(actor.assembly.group); applyActor(actor);
      }
      keyLight.color.set(palette.paper); fillLight.color.set(palette.paper); rimLight.color.set(palette.paper); floorMaterial.color.set(palette.ink); wake();
    });
    surface.__tourStudioInspect = () => {
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      return {
        lesson: active.lesson, frames, settled, renderer: { ...renderer.info.render, memory: { ...renderer.info.memory }, programs: renderer.info.programs?.length ?? 0 },
        viewport: { width, height, dpr: renderer.getPixelRatio() },
        take: take ? { ...take } : null,
        camera: { projectionMatrix: camera.projectionMatrix.toArray(), matrixWorldInverse: camera.matrixWorldInverse.toArray(), position: camera.position.toArray(), distance: distance.value },
        models: actors.map(actor => {
          const meshes: unknown[] = [];
          actor.assembly.group.traverse(object => {
            if (!(object instanceof THREE.Mesh)) return;
            object.geometry.computeBoundingBox(); const bounds = object.geometry.boundingBox;
            if (bounds) {
              const path: string[] = []; let current: THREE.Object3D | null = object, effectiveVisible = true;
              while (current) { effectiveVisible = effectiveVisible && current.visible; path.unshift(current.name || current.type); current = current.parent; }
              const materials = Array.isArray(object.material) ? object.material : [object.material];
              const textureIds = materials.map(material => "map" in material && material.map instanceof THREE.Texture ? material.map.uuid : null);
              meshes.push({ name: object.name, path: path.join("/"), id: object.id, textureId: textureIds[0], textureIds, visible: effectiveVisible, min: bounds.min.toArray(), max: bounds.max.toArray(), matrixWorld: object.matrixWorld.toArray() });
            }
          });
          return { lesson: actor.lesson, active: actor === active, progress: actor.pose.value, worldMatrix: actor.assembly.group.matrixWorld.toArray(), meshes };
        }),
      };
    };
    runtime.current = { paint: draw, update(next) {
      const changed = next.lesson !== config.lesson, replayed = next.replayKey !== config.replayKey;
      config = next;
      if (changed) {
        take = null;
        active = actors.find(actor => actor.lesson === next.lesson) ?? createActor(next.lesson);
        for (const actor of actors) {
          const current = actor === active;
          actor.weight.target = current ? 1 : 0; actor.x.target = current ? 0 : -4.2; actor.y.target = current ? 0 : -.1; actor.z.target = current ? 0 : -1.2; actor.yaw.target = current ? 0 : .9;
        }
        // Repeated fast clicks cannot retain a queue of assemblies or allocate without bound.
        while (actors.length > 3) {
          const candidates = actors.filter(actor => actor !== active).sort((a, b) => a.weight.value - b.weight.value);
          if (candidates[0]) removeActor(candidates[0]);
        }
        fitCamera();
      }
      active.pose.target = next.after ? 1 : 0; angle.target = targetAngle();
      if (replayed && !changed) {
        take = { kind: "replay", phase: "pullback", endYaw: active.yaw.value + Math.PI * 2 };
        active.yaw.target = active.yaw.value; elevation.target = .19; fitCamera();
      }
      wake();
    } };
    surface.addEventListener("webglcontextlost", onLost); surface.addEventListener("webglcontextrestored", onRestored);
    document.addEventListener("visibilitychange", onVisibility);
    resizeObserver.observe(element); intersection.observe(element);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-color-scheme"] });
    setAvailable(true); resize();
    distance.value = distance.target; angle.target = targetAngle();
    if (!isRunning()) settleScene();
    wake();
    return () => {
      disposed = true; stop(); runtime.current = null; delete surface.__tourStudioInspect;
      resizeObserver.disconnect(); intersection.disconnect(); theme.disconnect();
      surface.removeEventListener("webglcontextlost", onLost); surface.removeEventListener("webglcontextrestored", onRestored);
      document.removeEventListener("visibilitychange", onVisibility);
      actors.slice().forEach(removeActor); disposeEnvironment(); pmrem.dispose(); floorGeometry.dispose(); floorMaterial.dispose();
      keyLight.shadow.dispose(); renderer.dispose();
      // StrictMode reuses this connected canvas; release a context only on a real DOM unmount.
      queueMicrotask(() => { if (!surface.isConnected) renderer.forceContextLoss(); });
    };
  // One renderer for the mounted stage; requested changes retarget the current physical pose.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => runtime.current?.update(props), [props.lesson, props.after, props.running, props.reduced, props.replayKey]);
  useLayoutEffect(() => { if (available) runtime.current?.paint(); }, [available]);
  return <div ref={host} className="tour-studio-scene" data-renderer={available ? "webgl" : "fallback"} data-scene-lesson={props.lesson}>
    <canvas ref={canvas} data-testid="tour-studio-canvas" aria-hidden="true" hidden={!available} />
    {!available ? props.fallback : null}
  </div>;
}
