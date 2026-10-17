import { companionGaze, type CompanionPose } from '../companion-state.ts';

/** Original SVG companion: finite reactions and one coalesced pointer frame. */
export function createCompanion(face: Element, target: HTMLElement) {
  const eyes = face.querySelector<SVGElement>('.companion-eyes');
  const look = face.querySelector<SVGElement>('.companion-gaze');
  if (!eyes || !look) throw new Error('Missing companion face layers');
  const listeners = new AbortController();
  const animations = new Set<Animation>();
  let enabled = false;
  let visible = true;
  let reduced = false;
  let pose: CompanionPose = 'quiet';
  face.setAttribute('data-pose', pose);
  let bounds: DOMRect | undefined;
  let frame: number | undefined;
  let gaze = { x: 0, y: 0 };

  function clear(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined; bounds = undefined;
    for (const animation of animations) animation.cancel();
    animations.clear(); look!.style.removeProperty('transform');
  }

  function react(element: Element, frames: Keyframe[], duration: number): void {
    if (!enabled || !visible || reduced || animations.size >= 2 || face.getBoundingClientRect().width === 0) return;
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.22,1,.36,1)' });
    animations.add(animation);
    void animation.finished.catch(() => undefined).then(() => animations.delete(animation));
  }
  function celebrate(): void {
    react(face, [{ transform: 'translateY(0)' }, { transform: 'translateY(-2px)', offset: .4 }, { transform: 'translateY(0)' }], 240);
  }

  target.addEventListener('pointerenter', () => {
    if (!enabled || !visible || reduced) return;
    const rectangle = face.getBoundingClientRect();
    if (rectangle.width > 0 && rectangle.height > 0) bounds = rectangle;
  }, { signal: listeners.signal });
  target.addEventListener('pointermove', event => {
    if (!enabled || !visible || reduced) return;
    // A state change invalidates geometry; reacquire once on the next interaction.
    if (!bounds) {
      const rectangle = face.getBoundingClientRect();
      if (rectangle.width <= 0 || rectangle.height <= 0) return;
      bounds = rectangle;
    }
    gaze = companionGaze(event.clientX - bounds.x, event.clientY - bounds.y, bounds.width, bounds.height);
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (enabled && visible && !reduced) look!.style.transform = `translate(${gaze.x}px, ${gaze.y}px)`;
    });
  }, { signal: listeners.signal });
  target.addEventListener('pointerleave', clear, { signal: listeners.signal });
  target.addEventListener('click', () => react(eyes!, [
    { transform: 'scaleY(1)' }, { transform: 'scaleY(.18)', offset: .4 }, { transform: 'scaleY(1)' },
  ], 140), { signal: listeners.signal });

  return {
    celebrate,
    update(next: { enabled: boolean; visible: boolean; reduced: boolean; pose: CompanionPose }) {
      const changed = next.pose !== pose;
      const availabilityChanged = next.enabled !== enabled || next.visible !== visible || next.reduced !== reduced;
      enabled = next.enabled; visible = next.visible; reduced = next.reduced; pose = next.pose;
      if (changed || availabilityChanged) clear();
      if (changed) face.setAttribute('data-pose', pose);
      if (availabilityChanged) face.setAttribute('data-motion', reduced ? 'reduced' : 'full');
      if (!enabled || !visible || reduced) clear();
      else if (changed && pose === 'complete') celebrate();
      else if (changed && pose === 'music') react(face, [
        { transform: 'rotate(0deg)' }, { transform: 'rotate(-4deg)', offset: .4 }, { transform: 'rotate(0deg)' },
      ], 320);
    },
    dispose() { enabled = false; clear(); listeners.abort(); },
  };
}
