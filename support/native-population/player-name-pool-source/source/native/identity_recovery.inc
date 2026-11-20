#include "identity_recovery.h"
static struct ir_request ir_current;
static _Atomic int recovery_stage;
static uint32_t recovery_done,recovery_index,recovery_calls,recovery_scan_complete;
static int recovery_error;
static struct fresh_actor selected;
static struct identity rw,rg,rm,teams[2];
static int phase;
static uint64_t ready_at;
static uint64_t qualify_first[99],qualify_last[99];
static unsigned qualify_samples[99],qualify_cursor;
static int restore_hook(void){return 1;}
static void fail(int e){recovery_error=e;atomic_store(&recovery_stage,-e);restore_hook();}
static int blank_identity(const struct table*t,up at,up cls){
 struct field a,b;unsigned char online[16],unique[48];
 if(!find_property(t,cls,"OnlineUserId","StrProperty",16,0x770,NULL,&a)||!find_property(t,cls,"UniqueID","StructProperty",48,0x2c8,NULL,&b)||!meta_named(t,ptr(b.descriptor+0x70),"ScriptStruct","/Script/Engine","UniqueNetIdRepl")||!rd(at+0x770,online,16)||!rd(at+0x2c8,unique,48))return 0;
 up v;memcpy(&v,unique,8);if(v!=0x18c5660)return 0;
 for(int i=0;i<16;i++){if(online[i])return 0;}
 for(int i=8;i<48;i++){if(unique[i])return 0;}
 return 1;
}
static int validate_target(const struct table*t,int detached){
 const struct ir_target*m=&ir_current.targets[recovery_index];struct obj o;struct slot s;uint32_t n;int occ;
 if(!slot_get(t,m->index,&s)||s.object!=m->address||s.serial!=m->serial||s.flags&BAD_SLOT||!hdr(m->address,&o)||o.index!=m->index||o.flags&BAD_OBJECT||o.cls!=classes[2].id.address||o.outer!=ptr(rw.address+0x30))return 0;
 up team=detached?0:m->team;if(!passive_actor_fields(t,m->address,team,-1)||!blank_identity(t,m->address,o.cls)||!player_array(t,rg.address,m->address,&n,&occ)||occ!=1)return 0;
 for(int i=0;i<2;i++)if(!team_player_array(t,teams[i].address,m->address,&n,&occ)||occ!=(!detached&&m->team==teams[i].address?1:0))return 0;
 selected=(struct fresh_actor){m->address,o,s.serial,callback_epoch};return 1;
}
static void step(void){
 int stage=atomic_load(&recovery_stage);if(stage<0||stage==3)return;
 if(!ue_main()||atomic_load(&transaction_active)||atomic_load(&reentry_detected)){fail(31);return;}
 if((long)syscall(SYS_gettid)!=(long)process_id){fail(10);return;}
 struct table t;if(!table_read(&t)){fail(11);return;}
 if(stage==0){if(current.required_classes_found!=6||!current.completed_scans)return;recovery_scan_complete=current.completed_scans;
 if(!graph(&t,&rw,&rg,&rm)||rw.address!=ir_current.world||rg.address!=ir_current.gs||!resolve_team(&t,rg.address,rw.address,1,&teams[0])||!resolve_team(&t,rg.address,rw.address,2,&teams[1])){fail(12);return;}
 ready_at=mono_ns()+1000000000;atomic_store(&recovery_stage,1);return;}
 struct identity w,g,m;if(!graph(&t,&w,&g,&m)||!same(w,rw)||!same(g,rg)||!same(m,rm)){fail(13);return;}
 if(recovery_index>=ir_current.count){atomic_store(&recovery_stage,3);if(!restore_hook())recovery_error=30;return;}
 atomic_store(&transaction_active,1);
 if(phase==0){
  recovery_index=qualify_cursor;
  if(!validate_target(&t,0)){fail(14);goto done;}
  uint64_t now=mono_ns();
  if(!qualify_first[qualify_cursor]||now-qualify_last[qualify_cursor]>UINT64_C(5000000000)){
   qualify_first[qualify_cursor]=now;qualify_samples[qualify_cursor]=0;
  }
  qualify_last[qualify_cursor]=now;qualify_samples[qualify_cursor]++;
  qualify_cursor=(qualify_cursor+1)%ir_current.count;
  if(!qualify_cursor){
   int all=1;
   for(unsigned i=0;i<ir_current.count;i++)if(qualify_samples[i]<3||now-qualify_first[i]<UINT64_C(10000000000)||now-qualify_last[i]>UINT64_C(5000000000))all=0;
   if(all){recovery_index=0;phase=1;}
  }
  goto done;
 }
 if(phase==1){
  if(!validate_target(&t,0)){fail(14);goto done;}
  struct identity fn=cached_meta("SQPlayerState","SetTeamState"),fresh={0};if(!metadata_identity(&t,fn.address,&fresh)||!fresh_team_function(&t,fresh,selected.header.vptr)){fail(15);goto done;}
  up nullteam=0;recovery_calls++;((event_fn)ACTOR_PROCESS_EVENT)((void*)selected.address,(void*)fresh.address,&nullteam);phase=2;
 }else if(phase==2){
  if(!validate_target(&t,1)){fail(16);goto done;}
  struct identity fn=cached_meta("Actor","K2_DestroyActor"),fresh={0};if(!metadata_identity(&t,fn.address,&fresh)||!fresh_function(&t,fresh,"Actor","K2_DestroyActor",67240962U,0,65535,0x7a068e0,NULL,0)){fail(17);goto done;}
  recovery_calls++;((event_fn)ACTOR_PROCESS_EVENT)((void*)selected.address,(void*)fresh.address,NULL);phase=3;
 }else if(phase==3){
  uint32_t n;int occ;up at=ir_current.targets[recovery_index].address;
  if(!player_array(&t,rg.address,at,&n,&occ)||occ){fail(18);goto done;}
  for(int i=0;i<2;i++)if(!team_player_array(&t,teams[i].address,at,&n,&occ)||occ){fail(19);goto done;}
  recovery_done++;recovery_index++;phase=1;
 }
 done:atomic_store(&transaction_active,0);
}

int warmup_recovery_begin(const struct ir_request *r){
 if(!r||!ue_main()||atomic_load(&transaction_active)||r->pid!=(uint64_t)getpid()||!r->world||!r->gs||!r->count||r->count>99)return 0;
 ir_current=*r;phase=0;ready_at=0;recovery_done=recovery_index=recovery_calls=recovery_scan_complete=0;recovery_error=0;
 qualify_cursor=0;memset(qualify_first,0,sizeof qualify_first);memset(qualify_last,0,sizeof qualify_last);memset(qualify_samples,0,sizeof qualify_samples);
 atomic_store(&recovery_stage,0);return 1;
}
void warmup_recovery_tick(struct ir_report *out){
 step();*out=(struct ir_report){atomic_load(&recovery_stage),recovery_error,recovery_done,recovery_index,recovery_calls};
}
