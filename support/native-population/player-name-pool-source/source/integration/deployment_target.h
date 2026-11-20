#ifndef SQUAD_POPULATION_DEPLOYMENT_TARGET_H
#define SQUAD_POPULATION_DEPLOYMENT_TARGET_H
/* One reviewed target. These values are not runtime input or generic paths. */
#define WARMUP_TARGET_HOSTNAME "squad-incus-bzss"
#define WARMUP_TARGET_UID 10001u
#define WARMUP_TARGET_GID 10001u
#define WARMUP_TARGET_BASE "/opt/squad-population/bzss-fixd"
#define WARMUP_TARGET_STATE "/var/lib/squad-population/bzss-fixd"
#define WARMUP_TARGET_MARKER WARMUP_TARGET_BASE "/integrated.marker"
#define WARMUP_TARGET_MARKER_TEXT "squad-population:bzss-fixd:20261107\n"
#endif
