export interface TransitionDependencies {
  resize(expanded: boolean): Promise<void>;
  animate(expanded: boolean): Promise<void>;
  cancelAnimation(): void;
  setInteractive(expanded: boolean): void;
  commit(expanded: boolean): void;
  onError(error: unknown): void;
}

export interface TransitionController {
  set(expanded: boolean, refresh?: boolean): Promise<boolean>;
  toggle(): Promise<boolean>;
  readonly expanded: boolean;
  readonly desired: boolean;
}

/**
 * Resize is serialized, while an obsolete animation can be cancelled immediately.
 * Callers resolve to the final confirmed window state, including after a failure.
 * commit updates presentation state; animate owns the animated geometry. Only the
 * stable expanded panel is interactive. The compact trigger remains interactive.
 */
export function createTransitionController(
  dependencies: TransitionDependencies,
  initiallyExpanded = false,
): TransitionController {
  let nativeExpanded = initiallyExpanded;
  let committedExpanded = initiallyExpanded;
  let desired = initiallyExpanded;
  let interrupt: (() => void) | undefined;
  let pending: Promise<boolean> | undefined;
  let resolvePending: ((expanded: boolean) => void) | undefined;

  function cancelAnimation(): void {
    dependencies.cancelAnimation();
    interrupt?.();
  }

  async function animate(expanded: boolean): Promise<'complete' | 'interrupted' | 'failed'> {
    let cancel!: () => void;
    const cancelled = new Promise<'interrupted'>(resolve => { cancel = () => resolve('interrupted'); });
    interrupt = cancel;
    try {
      // Promise.race lets an intent proceed even if a cancelled adapter is slow to
      // settle. A rejection handler remains attached to the obsolete animation.
      return await Promise.race([
        dependencies.animate(expanded).then(() => 'complete' as const), cancelled,
      ]);
    } catch (error) {
      dependencies.onError(error);
      dependencies.cancelAnimation();
      return 'failed';
    } finally {
      if (interrupt === cancel) interrupt = undefined;
    }
  }

  function commit(expanded: boolean): void {
    committedExpanded = expanded;
    dependencies.commit(expanded);
  }

  async function drain(): Promise<void> {
    for (;;) {
      dependencies.setInteractive(false);
      if (desired) {
        if (!nativeExpanded) {
          try {
            await dependencies.resize(true);
            nativeExpanded = true;
          } catch (error) {
            dependencies.onError(error);
            desired = nativeExpanded;
            commit(nativeExpanded);
          }
        }
        if (desired && nativeExpanded) {
          commit(true);
          const outcome = await animate(true);
          if (outcome === 'interrupted' || !desired) continue;
          // Failed animation retains the confirmed expanded native window.
          if (outcome === 'failed') commit(nativeExpanded);
        }
      } else {
        if (committedExpanded) {
          const outcome = await animate(false);
          if (outcome === 'interrupted' || desired) continue;
          if (outcome === 'failed') {
            desired = nativeExpanded;
            commit(nativeExpanded);
          }
        }
        if (!desired && nativeExpanded) {
          try {
            await dependencies.resize(false);
            nativeExpanded = false;
          } catch (error) {
            dependencies.onError(error);
            // The panel must fit the actual window after a failed shrink. The
            // previous expanded state remains confirmed and can be retried.
            desired = nativeExpanded;
            commit(nativeExpanded);
            const outcome = await animate(nativeExpanded);
            if (outcome === 'interrupted') continue;
          }
        }
        if (!nativeExpanded) commit(false);
      }
      if (desired !== nativeExpanded) continue;
      dependencies.setInteractive(nativeExpanded);
      // Clear the operation before resolving callers, never in a .finally()
      // microtask that could swallow a newly queued intent.
      const settle = resolvePending;
      pending = undefined;
      resolvePending = undefined;
      settle?.(nativeExpanded);
      return;
    }
  }

  function set(expanded: boolean, refresh = false): Promise<boolean> {
    const next = Boolean(expanded);
    if (!pending && next === nativeExpanded && !refresh) return Promise.resolve(nativeExpanded);
    const start = !pending;
    if (!pending) pending = new Promise<boolean>(resolve => { resolvePending = resolve; });
    // Every caller shares this operation. Repeated timer renders during slow IPC
    // cannot accumulate a controller-owned array of promise resolvers.
    const promise = pending;
    if (next !== desired || refresh) {
      desired = next;
      cancelAnimation();
    }
    if (start) void drain();
    return promise;
  }

  return {
    set,
    toggle: () => set(!desired),
    get expanded() { return committedExpanded; },
    get desired() { return desired; },
  };
}
