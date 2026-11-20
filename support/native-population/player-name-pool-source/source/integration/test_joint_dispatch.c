#include "joint_dispatch.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
static unsigned calls[4],checks,step;static char order[5];
static int reentry;static void *expected_engine;static uint32_t expected_float;static bool expected_idle;
static void values(void *e,float dt,bool idle){uint32_t bits;memcpy(&bits,&dt,4);assert(e==expected_engine&&bits==expected_float&&idle==expected_idle);checks++;}
static int enter(void){calls[0]++;order[step++]='E';return reentry;}
static void original(void *e,float dt,bool idle){values(e,dt,idle);calls[1]++;order[step++]='O';}
static void ticket(void *e,float dt,bool idle){values(e,dt,idle);calls[2]++;order[step++]='T';}
static void warmup(void *e,float dt,bool idle,int entered){values(e,dt,idle);assert(entered==reentry);calls[3]++;order[step++]='W';checks++;}
int main(void){
 for(unsigned i=0;i<100000;i++){
  step=0;memset(order,0,sizeof order);expected_engine=(void *)(uintptr_t)(0x10000+i*16);expected_float=i*7919;expected_idle=(i&1)!=0;reentry=(i%3)==0;
  float dt;memcpy(&dt,&expected_float,4);joint_tick_dispatch(expected_engine,dt,expected_idle,enter,original,ticket,warmup);
  assert(step==4&&!memcmp(order,"EOTW",4));checks++;
 }
 for(unsigned i=0;i<4;i++){assert(calls[i]==100000);checks++;}
 printf("{\"checks\":%u,\"iterations\":100000,\"order\":\"enter-original-ticket-warmup\",\"original_calls\":%u,\"ticket_calls\":%u,\"warmup_calls\":%u,\"game_used\":false}\n",checks,calls[1],calls[2],calls[3]);
 return 0;
}
