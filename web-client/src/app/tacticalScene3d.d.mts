export type TacticalSceneHandle = (() => void) & { refreshSnapshot(): void; isActive(): boolean };

export function mountTacticalScene3d(
  viewport: HTMLElement,
  options?: { liveMap?: string; getFeed?: () => unknown; opener?: HTMLElement; onBack?: () => void },
): TacticalSceneHandle;
