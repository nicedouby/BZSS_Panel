const FRIENDLY_SOURCE = new Set(["#7de6ff", "rgb(125, 230, 255)"]);
const ENEMY_SOURCE = new Set(["#ff97a3", "rgb(255, 151, 163)"]);
const NEUTRAL_SOURCE = new Set(["#cbd5e1", "rgb(203, 213, 225)"]);

const PLAYER_FRIENDLY = "#3b82f6";
const PLAYER_ENEMY = "#ef4444";
const PLAYER_NEUTRAL = "#cbd5e1";

let installed = false;
let observer: MutationObserver | null = null;

function normalizeColor(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function resolvePlayerColor(value: string | null | undefined) {
  const normalized = normalizeColor(value);
  if (FRIENDLY_SOURCE.has(normalized) || normalized === PLAYER_FRIENDLY) return PLAYER_FRIENDLY;
  if (ENEMY_SOURCE.has(normalized) || normalized === PLAYER_ENEMY) return PLAYER_ENEMY;
  if (NEUTRAL_SOURCE.has(normalized) || normalized === PLAYER_NEUTRAL) return PLAYER_NEUTRAL;
  return value || PLAYER_NEUTRAL;
}

function patchVehicleFilter(filter: SVGFilterElement) {
  const colorMatrix = filter.querySelector<SVGFEColorMatrixElement>("feColorMatrix");
  const componentAlpha = filter.querySelector<SVGFEFuncAElement>("feComponentTransfer feFuncA");
  const flood = filter.querySelector<SVGFEFloodElement>("feFlood");
  const composites = filter.querySelectorAll<SVGFECompositeElement>("feComposite");
  const outputComposite = composites.item(composites.length - 1);

  if (colorMatrix) {
    // Ignore source RGB entirely. Use only the PNG alpha channel as the icon mask.
    const alphaMaskMatrix = [
      "0 0 0 0 0",
      "0 0 0 0 0",
      "0 0 0 0 0",
      "0 0 0 1 0",
    ].join(" ");
    if (colorMatrix.getAttribute("values") !== alphaMaskMatrix) {
      colorMatrix.setAttribute("values", alphaMaskMatrix);
    }
  }

  if (componentAlpha) {
    if (componentAlpha.getAttribute("type") !== "linear") componentAlpha.setAttribute("type", "linear");
    if (componentAlpha.getAttribute("slope") !== "1") componentAlpha.setAttribute("slope", "1");
    if (componentAlpha.getAttribute("intercept") !== "0") componentAlpha.setAttribute("intercept", "0");
  }

  if (flood) {
    const resolved = resolvePlayerColor(flood.getAttribute("flood-color"));
    if (flood.getAttribute("flood-color") !== resolved) {
      flood.setAttribute("flood-color", resolved);
    }
  }

  if (outputComposite) {
    // Output only the tinted alpha-mask result. Do not blend SourceGraphic back in,
    // otherwise the PNG's gray/white pixels contaminate the team color.
    if (outputComposite.getAttribute("operator") !== "arithmetic") {
      outputComposite.setAttribute("operator", "arithmetic");
    }
    outputComposite.setAttribute("k1", "0");
    outputComposite.setAttribute("k2", "1");
    outputComposite.setAttribute("k3", "0");
    outputComposite.setAttribute("k4", "0");
  }
}

function patchVehicleFilters(root: ParentNode) {
  if (root instanceof SVGFilterElement && root.id.startsWith("vehicle-white-tint-")) {
    patchVehicleFilter(root);
  }

  for (const filter of Array.from(root.querySelectorAll<SVGFilterElement>('filter[id^="vehicle-white-tint-"]'))) {
    patchVehicleFilter(filter);
  }
}

function findFilterFromMutationTarget(target: Node) {
  if (!(target instanceof Element)) return null;
  return target.closest<SVGFilterElement>('filter[id^="vehicle-white-tint-"]');
}

export function ensureTacticalVehicleIconTintController() {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;

  patchVehicleFilters(document);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const targetFilter = findFilterFromMutationTarget(mutation.target);
      if (targetFilter) patchVehicleFilter(targetFilter);

      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) patchVehicleFilters(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["flood-color", "values", "slope", "intercept", "operator", "k1", "k2", "k3", "k4"],
  });
}
