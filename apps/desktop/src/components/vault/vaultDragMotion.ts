/** Visual copies only: these motions never move or remove stored content. */
export type VaultMotionDestination = { left: number; top: number; width: number; height: number };
export type VaultDragMotion = {
  move: (x: number, y: number) => void;
  finish: (kind: "store" | "oh" | "return", target?: VaultMotionDestination, receiver?: HTMLElement) => void;
  dispose: () => void;
};

const live = new Set<() => void>();
let sequence = 0;
const reduced = (): boolean => document.hidden || document.documentElement.dataset.ogMotion === "reduced" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const duration = (factor = 1): number => {
  const value = token("--og-dur-3");
  const parsed = parseFloat(value);
  return (Number.isFinite(parsed) ? parsed * (value.endsWith("ms") ? 1 : 1000) : 220) * factor;
};
const transform = (x: number, y: number, scale = 1, angle = 0): string => `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`;
const center = (rect: VaultMotionDestination): { x: number; y: number } => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

export function disposeVaultCardMotions(): void {
  for (const dispose of [...live]) dispose();
}

/** Acknowledges actual delivery after the card reaches its receiving control. */
function acknowledgeReceiver(receiver: HTMLElement): void {
  if (reduced() || !receiver.isConnected || !receiver.animate) return;
  const base = getComputedStyle(receiver).transform, total = duration(1.1);
  const transformBase = base === "none" ? "" : base;
  let disposed = false, timeout: number | undefined;
  const animation = receiver.animate([
    { transform: `${transformBase} scale(1)` },
    { transform: `${transformBase} scale(.92)`, offset: .25 },
    { transform: `${transformBase} scale(1.04)`, offset: .7 },
    { transform: `${transformBase} scale(1)` },
  ], { duration: total, easing: token("--og-ease-spring") });
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const dispose = (): void => {
    if (disposed) return;
    disposed = true; window.clearTimeout(timeout);
    animation.onfinish = null; animation.oncancel = null; animation.cancel();
    observer.disconnect(); media.removeEventListener("change", preferenceChanged);
    document.removeEventListener("visibilitychange", preferenceChanged); live.delete(dispose);
  };
  const preferenceChanged = (): void => { if (reduced()) dispose(); };
  const observer = new MutationObserver(preferenceChanged);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-og-motion"] });
  media.addEventListener("change", preferenceChanged);
  document.addEventListener("visibilitychange", preferenceChanged); live.add(dispose);
  animation.onfinish = dispose; animation.oncancel = dispose;
  timeout = window.setTimeout(dispose, total + 100);
}

export function beginVaultCardMotion(card: HTMLDivElement, source: HTMLElement | null, x: number, y: number): VaultDragMotion {
  const id = String(++sequence);
  const origin = source ? center(source.getBoundingClientRect()) : { x, y };
  const inner = card.querySelector<HTMLElement>(".vault-drag-card");
  let current = { x, y }, disposed = false, settling = false;
  let lift: Animation | undefined, flight: Animation | undefined, timeout: number | undefined;
  card.dataset.vaultMotion = "lift";
  document.body.append(card);
  const place = (pointerX: number, pointerY: number): { x: number; y: number } => {
    const widthOfCard = card.offsetWidth, heightOfCard = card.offsetHeight, gap = parseFloat(token("--og-space-3")) || 12;
    const view = visualViewport, left = view?.offsetLeft ?? 0, top = view?.offsetTop ?? 0;
    const width = view?.width ?? innerWidth, height = view?.height ?? innerHeight;
    return {
      x: Math.max(left + widthOfCard / 2 + gap, Math.min(left + width - widthOfCard / 2 - gap, pointerX)),
      y: Math.max(top + heightOfCard / 2 + gap, Math.min(top + height - heightOfCard / 2 - gap, pointerY - heightOfCard / 2 - gap)),
    };
  };
  current = place(x, y);
  card.style.transform = transform(current.x, current.y);
  if (source) { source.dataset.vaultLift = id; source.classList.add("is-vault-lifted"); }
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const clearLift = (): void => {
    if (!lift) return;
    lift.onfinish = null; lift.oncancel = null; lift.cancel(); lift = undefined;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true; window.clearTimeout(timeout); clearLift();
    if (flight) { flight.onfinish = null; flight.oncancel = null; flight.cancel(); }
    observer.disconnect(); media.removeEventListener("change", preferenceChanged);
    document.removeEventListener("visibilitychange", preferenceChanged);
    if (source?.dataset.vaultLift === id) { delete source.dataset.vaultLift; source.classList.remove("is-vault-lifted"); }
    card.remove(); live.delete(dispose);
  };
  const preferenceChanged = (): void => {
    if (!reduced()) return;
    if (settling) dispose();
    else { clearLift(); card.dataset.vaultMotion = "drag"; }
  };
  const observer = new MutationObserver(preferenceChanged);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-og-motion"] });
  media.addEventListener("change", preferenceChanged);
  document.addEventListener("visibilitychange", preferenceChanged); live.add(dispose);
  if (!reduced() && inner?.animate) {
    lift = inner.animate([
      { transform: "translateY(20%) scale(.88) rotate(-4deg)", opacity: .4 },
      { transform: "translateY(-3%) scale(1.025) rotate(1deg)", opacity: 1, offset: .72 },
      { transform: "translateY(0) scale(1) rotate(0)", opacity: 1 },
    ], { duration: duration(1.2), easing: token("--og-ease-spring"), fill: "both" });
    lift.onfinish = () => { clearLift(); if (!settling) card.dataset.vaultMotion = "drag"; };
  } else card.dataset.vaultMotion = "drag";

  return {
    move(pointerX, pointerY) {
      if (disposed || settling) return;
      const next = place(pointerX, pointerY), angle = reduced() ? 0 : Math.max(-3, Math.min(3, (next.x - current.x) * .08));
      current = next; card.style.transform = transform(next.x, next.y, 1, angle);
    },
    finish(kind, target, receiver) {
      if (disposed || settling) return;
      settling = true; clearLift(); card.dataset.vaultMotion = kind;
      const destination = kind === "return" ? source?.isConnected ? center(source.getBoundingClientRect()) : origin : target ? center(target) : origin;
      card.dataset.vaultDestinationX = String(destination.x);
      card.dataset.vaultDestinationY = String(destination.y);
      if (reduced() || !card.animate) { dispose(); return; }
      const total = duration(kind === "return" ? 1.3 : 1.65);
      const frames: Keyframe[] = kind === "return" ? [
        { transform: card.style.transform, opacity: 1 },
        { transform: transform(destination.x, destination.y, .94), opacity: .5, offset: .78 },
        { transform: transform(destination.x, destination.y, .9), opacity: 0 },
      ] : [
        { transform: card.style.transform, opacity: 1 },
        { transform: transform(current.x + (destination.x - current.x) * .42, Math.min(current.y, destination.y) - 28, .84, kind === "oh" ? 3 : -3), opacity: .95, offset: .48 },
        { transform: transform(destination.x, destination.y, .12), opacity: 0 },
      ];
      flight = card.animate(frames, { duration: total, easing: token("--og-ease-standard"), fill: "forwards" });
      flight.onfinish = () => {
        dispose();
        if (kind !== "return" && receiver) acknowledgeReceiver(receiver);
      };
      flight.oncancel = dispose;
      timeout = window.setTimeout(dispose, total + 100);
    },
    dispose,
  };
}

/** A brief lift out of the collection accompanies opening; it is not deletion. */
export function playVaultTakeout(card: HTMLDivElement, origin: VaultMotionDestination): void {
  if (reduced()) return;
  const point = center(origin), total = duration(1.5);
  let disposed = false, animation: Animation | undefined, timeout: number | undefined;
  card.dataset.vaultMotion = "takeout";
  card.style.transform = transform(point.x, point.y);
  document.body.append(card);
  const dispose = (): void => {
    if (disposed) return;
    disposed = true; window.clearTimeout(timeout);
    if (animation) { animation.onfinish = null; animation.oncancel = null; animation.cancel(); }
    observer.disconnect(); media.removeEventListener("change", preferenceChanged);
    document.removeEventListener("visibilitychange", preferenceChanged);
    card.remove(); live.delete(dispose);
  };
  const preferenceChanged = (): void => { if (reduced()) dispose(); };
  const observer = new MutationObserver(preferenceChanged), media = matchMedia("(prefers-reduced-motion: reduce)");
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-og-motion"] });
  media.addEventListener("change", preferenceChanged);
  document.addEventListener("visibilitychange", preferenceChanged); live.add(dispose);
  if (!card.animate) { dispose(); return; }
  const top = (visualViewport?.offsetTop ?? 0) + card.offsetHeight / 2 + (parseFloat(token("--og-space-3")) || 12);
  const liftY = Math.max(top, point.y - 64);
  animation = card.animate([
    { transform: transform(point.x, point.y, .94), opacity: .7 },
    { transform: transform(point.x, point.y + (liftY - point.y) * .4, 1.02, -2), opacity: 1, offset: .4 },
    { transform: transform(point.x, liftY, 1.04, -2), opacity: 0 },
  ], { duration: total, easing: token("--og-ease-decelerate"), fill: "forwards" });
  animation.onfinish = dispose; animation.oncancel = dispose;
  timeout = window.setTimeout(dispose, total + 100);
}
