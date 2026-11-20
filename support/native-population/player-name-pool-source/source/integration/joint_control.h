#ifndef SQUAD_POPULATION_JOINT_CONTROL_H
#define SQUAD_POPULATION_JOINT_CONTROL_H
#include <stdbool.h>
#if defined(NT_JOINT_WARMUP) != defined(WARMUP_JOINT_TICK)
#error "Both joint tick owners must be built together"
#endif
#if defined(NT_JOINT_WARMUP) && !defined(NT_WITH_GRAPH)
#error "Joint integration requires the existing ticket graph consumer"
#endif
/* Jointly linked, hidden entry points. No runtime callback registration. */
int warmup_control_joint_prepared(void);
int warmup_control_tick_enter(void);
void warmup_control_after_tick(void *,float,bool,int);
void warmup_control_joint_tick_installed(void);
int warmup_control_joint_start_worker(void);
#endif
