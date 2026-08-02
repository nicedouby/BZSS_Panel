// -*- coding: utf-8 -*-

import { calculatePressureZones } from "./engine.js";

export function simulatePressureZones(input = {}) {
  if (!input || typeof input !== "object") throw new Error("Simulation input must be an object.");
  return calculatePressureZones(input);
}
