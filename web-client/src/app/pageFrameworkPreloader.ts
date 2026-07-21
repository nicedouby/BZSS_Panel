import type { AuthUser } from "../stores/auth.store";
import { canAccessPage } from "../shared/web-page-permissions.js";
import {
  getPageDefinitionByPath,
  pageRegistry,
  resolvePagePermissions,
  type PageDefinition,
} from "./pageRegistry";

const PRELOAD_START_DELAY_MS = 120;
const INITIAL_BURST_SIZE = 8;
const PRELOAD_BATCH_SIZE = 5;
const IDLE_TIMEOUT_MS = 220;
const FALLBACK_IDLE_DELAY_MS = 35;

interface NetworkInformationLike {
  saveData?: boolean;
}

interface SupplementalPageDefinition {
  path: string;
  superAdminOnly?: boolean;
  load: () => Promise<unknown>;
}

const supplementalPages: SupplementalPageDefinition[] = [
  {
    path: "/system/logpost-diagnostics",
    superAdminOnly: true,
    load: () => import("../pages/LogPostDiagnosticsPage.vue"),
  },
  {
    path: "/system/logpost-consumption-performance",
    superAdminOnly: true,
    load: () => import("../pages/LogPostConsumptionPerformancePage.vue"),
  },
];

const loadedPaths = new Set<string>();
const pendingLoads = new Map<string, Promise<void>>();

let preloadGeneration = 0;
let preloadStartTimer: number | null = null;
let idleHandle: number | null = null;
let fallbackIdleTimer: number | null = null;

export function startPageFrameworkPreload(user: AuthUser | null, currentPath = "") {
  stopPageFrameworkPreload();
  if (!user || typeof window === "undefined" || shouldRespectDataSaver()) return;

  const generation = ++preloadGeneration;
  const normalizedCurrentPath = normalizePath(currentPath);
  if (normalizedCurrentPath !== "/") loadedPaths.add(normalizedCurrentPath);

  const pageQueue = pageRegistry
    .filter((page) => canUserAccessPage(page, user))
    .filter((page) => normalizePath(page.path) !== normalizedCurrentPath)
    .sort(comparePreloadPriority);
  const supplementalQueue = supplementalPages
    .filter((page) => !page.superAdminOnly || user.isSuperAdmin)
    .filter((page) => normalizePath(page.path) !== normalizedCurrentPath);

  preloadStartTimer = window.setTimeout(() => {
    preloadStartTimer = null;
    void preloadInitialBurst(generation, pageQueue, supplementalQueue, user);
  }, PRELOAD_START_DELAY_MS);
}

export function stopPageFrameworkPreload() {
  preloadGeneration += 1;
  if (typeof window === "undefined") return;

  if (preloadStartTimer != null) {
    window.clearTimeout(preloadStartTimer);
    preloadStartTimer = null;
  }

  if (idleHandle != null) {
    if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
    idleHandle = null;
  }

  if (fallbackIdleTimer != null) {
    window.clearTimeout(fallbackIdleTimer);
    fallbackIdleTimer = null;
  }
}

export function preloadPageFrameworkByPath(path: string, user: AuthUser | null) {
  if (!user) return Promise.resolve();

  const normalizedPath = normalizePath(path);
  const page = getPageDefinitionByPath(normalizedPath);
  if (page && canUserAccessPage(page, user)) {
    return loadPageDefinition(page);
  }

  const supplemental = supplementalPages.find((item) => normalizePath(item.path) === normalizedPath);
  if (!supplemental || (supplemental.superAdminOnly && !user.isSuperAdmin)) return Promise.resolve();
  return loadFramework(supplemental.path, supplemental.load);
}

export function preloadPageFrameworksByPaths(paths: string[], user: AuthUser | null) {
  if (!user) return Promise.resolve();

  const uniquePaths = [...new Set(paths.map(normalizePath).filter((path) => path !== "/"))];
  return Promise.allSettled(
    uniquePaths.map((path) => preloadPageFrameworkByPath(path, user)),
  ).then(() => undefined);
}

async function preloadInitialBurst(
  generation: number,
  pageQueue: PageDefinition[],
  supplementalQueue: SupplementalPageDefinition[],
  user: AuthUser,
) {
  if (generation !== preloadGeneration) return;

  const jobs = takePreloadJobs(INITIAL_BURST_SIZE, pageQueue, supplementalQueue, user);
  if (jobs.length > 0) await Promise.allSettled(jobs);
  scheduleNextBatch(generation, pageQueue, supplementalQueue, user);
}

function scheduleNextBatch(
  generation: number,
  pageQueue: PageDefinition[],
  supplementalQueue: SupplementalPageDefinition[],
  user: AuthUser,
) {
  if (generation !== preloadGeneration || typeof window === "undefined") return;
  if (pageQueue.length === 0 && supplementalQueue.length === 0) return;

  const run = () => {
    idleHandle = null;
    fallbackIdleTimer = null;
    if (generation !== preloadGeneration) return;
    void preloadBatch(generation, pageQueue, supplementalQueue, user);
  };

  if (typeof window.requestIdleCallback === "function") {
    idleHandle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  } else {
    fallbackIdleTimer = window.setTimeout(run, FALLBACK_IDLE_DELAY_MS);
  }
}

async function preloadBatch(
  generation: number,
  pageQueue: PageDefinition[],
  supplementalQueue: SupplementalPageDefinition[],
  user: AuthUser,
) {
  const jobs = takePreloadJobs(PRELOAD_BATCH_SIZE, pageQueue, supplementalQueue, user);
  if (jobs.length > 0) await Promise.allSettled(jobs);
  scheduleNextBatch(generation, pageQueue, supplementalQueue, user);
}

function takePreloadJobs(
  limit: number,
  pageQueue: PageDefinition[],
  supplementalQueue: SupplementalPageDefinition[],
  user: AuthUser,
) {
  const jobs: Promise<void>[] = [];

  while (jobs.length < limit && pageQueue.length > 0) {
    const page = pageQueue.shift();
    if (!page || !canUserAccessPage(page, user)) continue;
    jobs.push(loadPageDefinition(page));
  }

  while (jobs.length < limit && supplementalQueue.length > 0) {
    const page = supplementalQueue.shift();
    if (!page || (page.superAdminOnly && !user.isSuperAdmin)) continue;
    jobs.push(loadFramework(page.path, page.load));
  }

  return jobs;
}

function loadPageDefinition(page: PageDefinition) {
  if (typeof page.component !== "function") {
    loadedPaths.add(normalizePath(page.path));
    return Promise.resolve();
  }

  const loader = page.component as unknown as () => Promise<unknown>;
  return loadFramework(page.path, loader);
}

function loadFramework(path: string, loader: () => Promise<unknown>) {
  const key = normalizePath(path);
  if (loadedPaths.has(key)) return Promise.resolve();

  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const promise = Promise.resolve()
    .then(loader)
    .then(() => {
      loadedPaths.add(key);
    })
    .catch((error) => {
      console.warn(`[page-preloader] Failed to preload ${key}`, error);
    })
    .finally(() => {
      pendingLoads.delete(key);
    });

  pendingLoads.set(key, promise);
  return promise;
}

function canUserAccessPage(page: PageDefinition, user: AuthUser) {
  const permissions = resolvePagePermissions(page);
  if (permissions.superAdminOnly && !user.isSuperAdmin) return false;
  if (!permissions.requiredPermission) return true;

  return canAccessPage(
    user,
    permissions.requiredPermission,
    permissions.legacyRequiredPermissions,
    { superAdminOnly: permissions.superAdminOnly },
  );
}

function comparePreloadPriority(left: PageDefinition, right: PageDefinition) {
  const leftVisible = left.nav && !left.nav.hidden ? 1 : 0;
  const rightVisible = right.nav && !right.nav.hidden ? 1 : 0;
  if (leftVisible !== rightVisible) return rightVisible - leftVisible;

  const categoryPriority: Record<PageDefinition["category"], number> = {
    core: 0,
    plugin: 1,
    system: 2,
    debug: 3,
  };
  const categoryDelta = categoryPriority[left.category] - categoryPriority[right.category];
  if (categoryDelta !== 0) return categoryDelta;

  return Number(left.nav?.order ?? 10_000) - Number(right.nav?.order ?? 10_000);
}

function shouldRespectDataSaver() {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return Boolean(connection?.saveData);
}

function normalizePath(path: string) {
  const text = String(path ?? "").trim();
  if (!text) return "/";
  return text.split("?")[0].split("#")[0] || "/";
}
