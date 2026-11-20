#include "round_cycle.h"
#include <string.h>
#define DELAY_NS UINT64_C(3000000000)
enum rc_phase rc_classify(const char *s){
 if(!s)return RC_UNKNOWN;
 if(!strcmp(s,"WaitingToStart"))return RC_STARTING;
 if(!strcmp(s,"InProgress"))return RC_PLAYING;
 if(!strcmp(s,"WaitingPostMatch"))return RC_SETTLEMENT;
 if(!strcmp(s,"LeavingMap")||!strcmp(s,"EnteringMap"))return RC_TRAVEL;
 return RC_UNKNOWN;
}
enum rc_action rc_step(struct rc_state *s,const struct rc_input *v){
 if(!s||!v)return RC_FAULT;
 if(s->fault)return RC_FAULT;
 if(!v->world||!v->now_ns||v->phase==RC_UNKNOWN)return RC_HOLD;
 if(!s->initialized){s->initialized=1;s->world=v->world;}
 /* Seamless travel may expose a temporary World with LeavingMap. It is
    not a new round and must not consume the previous cleanup witness. */
 if(v->phase==RC_TRAVEL){
  if(!s->ending){s->ending=1;s->running=0;s->start_ns=0;}
  if(v->world==s->world&&v->clear)s->cleared_old=1;
  return RC_HOLD;
 }
 if(v->world!=s->world){
  if(v->phase!=RC_STARTING&&v->phase!=RC_PLAYING)return RC_HOLD;
  /* Never silently recover identities that were still owned at travel. */
  if(!s->ending||!s->cleared_old){s->fault=1;return RC_FAULT;}
  s->world=v->world;s->start_ns=0;s->ending=0;s->cleared_old=0;s->running=0;++s->completed_cycles;
 }
 if(v->phase==RC_SETTLEMENT){
  s->ending=1;s->running=0;s->start_ns=0;
  if(v->clear)s->cleared_old=1;
  return RC_DRAIN;
 }
 /* Settlement is latched until a new World is witnessed, including late
    repeated callbacks reporting a playing state from the ending World. */
 if(s->ending){if(v->clear)s->cleared_old=1;return RC_DRAIN;}
 if(s->running)return RC_RUN;
 if(!s->start_ns)s->start_ns=v->now_ns;
 if(v->now_ns<s->start_ns){s->fault=1;return RC_FAULT;}
 if(v->now_ns-s->start_ns<DELAY_NS||!v->ready)return RC_WAIT;
 s->running=1;return RC_RUN;
}
