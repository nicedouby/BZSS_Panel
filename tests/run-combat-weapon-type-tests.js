import assert from "node:assert/strict";

import { classifyWeaponType } from "../modules/combat-clean/weapon-type.js";

function expectLight(displayName, cleaned = displayName) {
  const result = classifyWeaponType({ displayName, cleaned });
  assert.equal(result.key, "light");
  assert.ok(["exact", "contains", "regex"].includes(result.matchedBy));
  assert.ok(result.label);
  return result;
}

function testCoreLightWeaponClassification() {
  const result = expectLight("C7A2 ET552 Foregrip");
  assert.ok(result.matchedTerm.includes("c7a2"));
}

function testAttachmentLightWeaponClassification() {
  expectLight("AK101 PushCO M150 Foregrip");
}

function testG3SG1Classification() {
  expectLight("G3SG1 Optic");
}

function testMPT76Classification() {
  expectLight("MPT76 Foregrip A940");
}

function testMicePanelBlueprintHints() {
  expectLight("SOR109T HNA 4mag");
  expectLight("M21 Meupold");
  expectLight("PMT76 A940");
}

function testCategoryDoesNotSuppressLightWeaponClassification() {
  const result = classifyWeaponType({
    displayName: "C7A2 Ironsights",
    cleaned: "C7A2 Ironsights",
    raw: "BP_C7A2_Ironsights_C_1002",
    category: "pawn",
    sourceType: "rawCausedBy",
  });

  assert.equal(result.key, "light");
  assert.ok(["exact", "contains", "regex"].includes(result.matchedBy));
}

function testAntiTankWeaponClassification() {
  const result = classifyWeaponType({
    displayName: "M72 LAW",
    cleaned: "M72 LAW",
  });

  assert.equal(result.key, "anti_tank");
  assert.ok(["exact", "contains", "regex"].includes(result.matchedBy));
}

function testPlaceholderFallsBackToOther() {
  const result = classifyWeaponType({
    displayName: "Soldier CAF Grenadier",
    cleaned: "Soldier CAF Grenadier",
  });

  assert.equal(result.key, "other");
  assert.equal(result.matchedBy, "placeholder");
}

function testExplosiveWeaponClassification() {
  const result = classifyWeaponType({
    displayName: "Projectile 30mm HE Red",
    cleaned: "Projectile 30mm HE Red",
  });

  assert.equal(result.key, "explosive");
  assert.ok(["contains", "regex"].includes(result.matchedBy));
}

function testMeleeWeaponClassification() {
  const result = classifyWeaponType({
    displayName: "Knife",
    cleaned: "Knife",
  });

  assert.equal(result.key, "melee");
  assert.equal(result.matchedBy, "exact");
}

testCoreLightWeaponClassification();
testAttachmentLightWeaponClassification();
testG3SG1Classification();
testMPT76Classification();
testMicePanelBlueprintHints();
testCategoryDoesNotSuppressLightWeaponClassification();
testAntiTankWeaponClassification();
testPlaceholderFallsBackToOther();
testExplosiveWeaponClassification();
testMeleeWeaponClassification();

console.log("combat weapon type tests passed");
