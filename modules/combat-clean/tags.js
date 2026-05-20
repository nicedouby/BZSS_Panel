// -*- coding: utf-8 -*-

export const CombatEventTags = Object.freeze({
  Damage: "combat.damage",
  Wound: "combat.wound",
  Kill: "combat.kill",
});

export const WeaponCategoryTags = Object.freeze({
  SmallArm: "weapon.small_arm",
  Explosive: "weapon.explosive",
  Vehicle: "weapon.vehicle",
  Emplacement: "weapon.emplacement",
  Melee: "weapon.melee",
  UnknownWeapon: "weapon.unknown",
});

export const SmallArmTags = Object.freeze({
  Rifle: "weapon.rifle",
  Carbine: "weapon.carbine",
  MachineGun: "weapon.machine_gun",
  MarksmanRifle: "weapon.marksman_rifle",
  SniperRifle: "weapon.sniper_rifle",
  Pistol: "weapon.pistol",
  Shotgun: "weapon.shotgun",
});

export const DamageSourceTags = Object.freeze({
  Direct: "damage.direct",
  Splash: "damage.splash",
  Bleed: "damage.bleed",
  Fall: "damage.fall",
  Burn: "damage.burn",
  VehicleCrash: "damage.vehicle_crash",
  UnknownSource: "damage.unknown_source",
});

export const IdentityTags = Object.freeze({
  AttackerValid: "attacker.valid",
  AttackerNull: "attacker.null",
  AttackerWorld: "attacker.world",
  VictimValid: "victim.valid",
  VictimNull: "victim.null",
});

export const RelationTags = Object.freeze({
  Enemy: "relation.enemy",
  Friendly: "relation.friendly",
  Self: "relation.self",
  UnknownRelation: "relation.unknown",
});

export const TeamKillTags = Object.freeze({
  TeamDamage: "combat.team_damage",
  TeamWound: "combat.team_wound",
  TeamKill: "combat.team_kill",
});

export const ConfidenceTags = Object.freeze({
  High: "confidence.high",
  Medium: "confidence.medium",
  Low: "confidence.low",
});
