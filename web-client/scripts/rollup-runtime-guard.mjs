// -*- coding: utf-8 -*-

/**
 * Rollup creates null-prototype path trackers with symbol-keyed descriptors.
 * That is valid ECMAScript, but a build-time dependency or Node preload can
 * replace Object.create/Object.defineProperties with a legacy implementation
 * that rejects null-prototype objects. Preserve known-good references and
 * restore them after plugin transforms, before Rollup performs tree-shaking.
 */

const objectTarget = Object;
const reflectDefineProperty = Reflect.defineProperty.bind(Reflect);
const reflectOwnKeys = Reflect.ownKeys.bind(Reflect);
const capturedCreate = Object.create;
const capturedDefineProperty = Object.defineProperty;
const capturedDefineProperties = Object.defineProperties;
const capturedGetPrototypeOf = Object.getPrototypeOf;

const originalDescriptors = new Map([
  ["create", Object.getOwnPropertyDescriptor(Object, "create")],
  ["defineProperty", Object.getOwnPropertyDescriptor(Object, "defineProperty")],
  ["defineProperties", Object.getOwnPropertyDescriptor(Object, "defineProperties")],
]);

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function definePropertyCompat(target, key, descriptor) {
  if (!isObjectLike(target)) {
    throw new TypeError("Object.defineProperty called on non-object");
  }
  if (!isObjectLike(descriptor)) {
    throw new TypeError(`Property description must be an object: ${String(descriptor)}`);
  }
  if (!reflectDefineProperty(target, key, descriptor)) {
    throw new TypeError(`Cannot define property ${String(key)}`);
  }
  return target;
}

function definePropertiesCompat(target, descriptors) {
  if (!isObjectLike(target)) {
    throw new TypeError("Object.defineProperties called on non-object");
  }
  const descriptorMap = Object(descriptors);
  for (const key of reflectOwnKeys(descriptorMap)) {
    definePropertyCompat(target, key, descriptorMap[key]);
  }
  return target;
}

function createCompat(prototype, descriptors) {
  if (prototype !== null && !isObjectLike(prototype)) {
    throw new TypeError("Object prototype may only be an Object or null");
  }

  // Avoid calling a possibly polluted Object.create.  The literal gives us
  // a normal object and Reflect.setPrototypeOf handles the non-null case.
  const target = { __proto__: null };
  if (prototype !== null) Reflect.setPrototypeOf(target, prototype);

  if (descriptors !== undefined) {
    definePropertiesCompat(target, descriptors);
  }
  return target;
}

function supportsRollupPathTracker(create, getPrototypeOf) {
  try {
    const key = Symbol("bzss-rollup-runtime-check");
    const value = new Set();
    const target = create(null, {
      [key]: { value },
    });
    return getPrototypeOf(target) === null && target[key] === value;
  } catch {
    return false;
  }
}

// Do not restore captured methods merely because Object.create(null) happens
// to work.  The failure seen in Rollup is specifically caused by a partially
// patched intrinsic set: Object.create can pass the probe while
// Object.defineProperties still rejects Rollup's null-prototype tracker.
// The compatibility implementations below use Reflect primitives and are
// deliberately used as the canonical set for the complete build.
const canonical = {
  create: createCompat,
  defineProperty: definePropertyCompat,
  defineProperties: definePropertiesCompat,
};

let viteLogger = null;
let repairNoticeEmitted = false;

function restoreObjectIntrinsics(phase) {
  const repaired = [];

  for (const [name, implementation] of Object.entries(canonical)) {
    if (Object[name] === implementation) continue;

    const original = originalDescriptors.get(name);
    const restored = reflectDefineProperty(objectTarget, name, {
      configurable: original?.configurable ?? true,
      enumerable: original?.enumerable ?? false,
      writable: original?.writable ?? true,
      value: implementation,
    });

    if (!restored) {
      throw new Error(
        `[build] Unable to restore Object.${name}; a build-time dependency made it non-configurable.`,
      );
    }
    repaired.push(name);
  }

  if (repaired.length > 0 && !repairNoticeEmitted) {
    repairNoticeEmitted = true;
    const message = `[build] Restored polluted JavaScript intrinsics during ${phase}: ${repaired
      .map((name) => `Object.${name}`)
      .join(", ")}`;
    if (viteLogger?.warn) viteLogger.warn(message);
    else console.warn(message);
  }

  if (!supportsRollupPathTracker(Object.create, Object.getPrototypeOf)) {
    throw new Error(
      "[build] Object.create(null, descriptors) is still incompatible after runtime repair.",
    );
  }
}

export function rollupRuntimeGuard() {
  restoreObjectIntrinsics("config-load");

  return {
    name: "bzss-rollup-runtime-guard",
    enforce: "post",
    configResolved(config) {
      viteLogger = config.logger;
      restoreObjectIntrinsics("config-resolved");
    },
    buildStart() {
      restoreObjectIntrinsics("build-start");
    },
    transform() {
      // This hook runs after normal transforms. If a lazily loaded transform
      // dependency patches Object globals, repair them before tree-shaking.
      restoreObjectIntrinsics("transform");
      return null;
    },
    moduleParsed() {
      restoreObjectIntrinsics("module-parsed");
    },
    buildEnd() {
      restoreObjectIntrinsics("build-end");
    },
    renderStart() {
      restoreObjectIntrinsics("render-start");
    },
  };
}
