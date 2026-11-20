#ifndef SQUAD_POPULATION_JOINT_DISPATCH_H
#define SQUAD_POPULATION_JOINT_DISPATCH_H
#include <stdbool.h>
typedef void (*joint_tick_fn)(void *,float,bool);
typedef int (*joint_enter_fn)(void);
typedef void (*joint_after_fn)(void *,float,bool,int);
/* Production supplies only fixed original/consumer function addresses.
 * This helper never reads or chains a pre-existing tick-cell pointer. */
static inline void joint_tick_dispatch(void *engine,float dt,bool idle,
        joint_enter_fn enter,joint_tick_fn original,joint_tick_fn ticket,
        joint_after_fn warmup) {
    const int reentered=enter();
    original(engine,dt,idle);
    ticket(engine,dt,idle);
    warmup(engine,dt,idle,reentered);
}
#endif
