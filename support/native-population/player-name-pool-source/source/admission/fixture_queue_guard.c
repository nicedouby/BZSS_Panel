/* Actual guard policy with compile-time memory/original-gate dependencies.
 * Never calls install/mprotect, a game SO, UE or networking. */
#define WARMUP_QUEUE_GUARD_FIXTURE 1
#include "queue_guard.c"
#include <stdlib.h>
#include <pthread.h>
struct region { uint64_t address;size_t bytes;unsigned char data[2048]; };
static struct region regions[24];static size_t regions_used;
static struct warmup_ue_queue_view test_view;
static int test_armed,test_failed,test_ready,test_provider,test_original_result,test_reenter;
static uint64_t test_outer;static unsigned assertions,native_calls;
#define CHECK(x) do{assertions++;if(!(x)){fprintf(stderr,"queue fixture assertion%u line%d: %s\n",assertions,__LINE__,#x);exit(1);}}while(0)
static unsigned char *address(uint64_t at,size_t bytes){for(size_t i=0;i<regions_used;i++)if(at>=regions[i].address&&at-regions[i].address+bytes<=regions[i].bytes)return regions[i].data+(size_t)(at-regions[i].address);return NULL;}
static void put(uint64_t at,const void *data,size_t bytes){if(regions_used>=24||bytes>2048)abort();struct region *r=&regions[regions_used++];r->address=at;r->bytes=bytes;memcpy(r->data,data,bytes);}
static void set(uint64_t at,const void *data,size_t bytes){unsigned char *p=address(at,bytes);if(!p)abort();memcpy(p,data,bytes);}
int qg_fixture_read(uint64_t at,void *out,size_t bytes){unsigned char *p=address(at,bytes);if(!p)return 0;memcpy(out,p,bytes);return 1;}
int qg_fixture_code_ready(void){return test_ready;}
int warmup_control_is_armed(void){return test_armed;}
int warmup_control_failed(void){return test_failed;}
uint64_t warmup_control_outer_epoch(void){return test_outer;}
int warmup_ue_queue_snapshot(struct warmup_ue_queue_view *out){if(!test_provider)return 0;*out=test_view;out->captured_ns=clock_ns();out->outer_gt_epoch=test_outer;return 1;}
bool qg_fixture_original(void *host,const void *entry,int32_t team){native_calls++;if(test_reenter){test_reenter=0;CHECK(!qg_wrapper(host,entry,team));}return test_original_result!=0;}
static void party(uint64_t at,int size,uint64_t beacon){int team=-1;struct qg_header members={0xa0000,size,size};set(at+0x10,&team,4);set(at+0x80,&beacon,8);set(at+0x90,&members,sizeof members);}
static void setup(int count){
 native_request_until=join_hold_until=0;yield_pending=0;fixture_cell=wrapper_address();drift_revision=0;atomic_store(&installed,1);warmup_queue_guard_config(1);atomic_store(&attached_revision,1);
 memset(regions,0,sizeof regions);regions_used=0;memset(requests,0,sizeof requests);request_world=last_allowed_world=last_allowed_outer=0;atomic_store(&entered,0);atomic_store(&ever_armed,0);atomic_store(&generation,1);atomic_store(&unknown,1);atomic_store(&reentries,0);atomic_store(&thread_errors,0);test_armed=test_ready=test_provider=test_original_result=1;test_failed=test_reenter=0;test_outer=1;native_calls=0;
 struct qg_table t={0x20000,0,16,16,1,1};put(QG_TABLE,&t,sizeof t);uint64_t chunk=0x30000;put(0x20000,&chunk,8);struct qg_slot slots[16]={0};
 struct warmup_native_weak_v1 weak[7];
 for(int i=0;i<7;i++){uint64_t at=0x40000+0x1000UL*(unsigned)i;weak[i]=(struct warmup_native_weak_v1){at,i,100+i};struct qg_object h={i==4?QG_HOST_VPTR:0x111100,0,i,0xb0000,0,0,0};unsigned char data[0x320]={0};memcpy(data,&h,sizeof h);put(at,data,sizeof data);slots[i]=(struct qg_slot){0,at,100+i,0};}
 put(0x30000,slots,sizeof slots);put(QG_WORLD,&weak[0].address,8);
 struct qg_header joining={0x70000,0,128},pub={0x80000,count,2},reserved={0,0,0};set(weak[4].address+0x2e0,&joining,sizeof joining);set(weak[4].address+0x2f0,&pub,sizeof pub);set(weak[4].address+0x300,&reserved,sizeof reserved);unsigned char rows[320]={0};put(0x80000,rows,sizeof rows);party(0x80000,1,weak[5].address);party(0x800a0,1,weak[6].address);
 memset(&test_view,0,sizeof test_view);test_view.abi_version=WARMUP_QUEUE_VIEW_ABI;test_view.struct_size=sizeof test_view;test_view.world_epoch=1;test_view.bindings=(struct wn_world){weak[0],weak[1],weak[2],weak[3]};test_view.host=weak[4];test_view.actual_gs_count=80;test_view.team_total[0]=test_view.team_total[1]=40;test_view.removable_owned_team[0]=test_view.removable_owned_team[1]=40;test_view.capacity=100;test_view.native_team_allowance=4;test_view.native_team_allowance_known=1;test_view.native_g=-1;
}
static int poll(struct wn_admission *out){return warmup_queue_guard_admission(NULL,test_view.world_epoch,&test_view.bindings,clock_ns(),out);}
static void *other_thread(void *unused){(void)unused;CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));return NULL;}
int main(void){struct wn_admission out;uint32_t needed[2];
 /* Max99 keeps the existing native gate and accepts the enlarged own roster. */
 /* Disabled mailbox wins before stale-snapshot, terminal and reentry checks. */
 setup(1);test_provider=0;test_failed=1;warmup_queue_guard_config(0);
 CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);
 test_original_result=0;CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==2);
 warmup_queue_guard_sync(0);CHECK(fixture_cell==QG_GATE&&!atomic_load(&installed));
 warmup_queue_guard_sync(0);CHECK(fixture_cell==QG_GATE);
 test_failed=0;warmup_queue_guard_config(2);warmup_queue_guard_sync(1);CHECK(fixture_cell==QG_GATE);
 warmup_queue_guard_sync(2);CHECK(fixture_cell==wrapper_address()&&atomic_load(&attached_revision)==2);
 warmup_queue_guard_sync(0);CHECK(fixture_cell==QG_GATE); /* settlement/travel */
 warmup_queue_guard_sync(2);fixture_cell=QG_GATE;warmup_queue_guard_sync(2);
 CHECK(fixture_cell==QG_GATE&&!atomic_load(&installed)); /* externally detached */
 warmup_queue_guard_config(3);fixture_cell=0x12345678;warmup_queue_guard_sync(3);
 CHECK(fixture_cell==0x12345678);fixture_cell=QG_GATE;warmup_queue_guard_sync(3);CHECK(fixture_cell==QG_GATE);
 warmup_queue_guard_config(4);warmup_queue_guard_sync(4);CHECK(fixture_cell==wrapper_address());
 test_failed=1;warmup_queue_guard_sync(4);CHECK(fixture_cell==QG_GATE);
 setup(1);test_view.actual_gs_count=99;test_view.team_total[0]=50;test_view.team_total[1]=49;test_view.removable_owned_team[0]=50;test_view.removable_owned_team[1]=49;
 CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,2));CHECK(native_calls==1);
 setup(1);test_view.actual_gs_count=100;test_view.team_total[0]=test_view.team_total[1]=50;test_view.removable_owned_team[0]=49;test_view.removable_owned_team[1]=50;
 CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,2));CHECK(native_calls==0);
 setup(1);test_armed=0;test_provider=0;CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);CHECK(!atomic_load(&ever_armed));
 setup(1);test_armed=0;test_failed=1;CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);
 setup(2);CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(!qg_wrapper((void *)0x44000,(void *)0x800a0,2));CHECK(native_calls==1);test_outer++;CHECK(qg_wrapper((void *)0x44000,(void *)0x800a0,2));CHECK(native_calls==2);
 setup(1);test_original_result=0;CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);test_original_result=1;CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==2);
 setup(1);test_provider=0;CHECK(poll(&out)==WN_OK&&out.party_safety_verified);
 CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);
 CHECK(poll(&out)==WN_OK&&!out.party_safety_verified&&!out.team_deficit[0]);
 test_original_result=0;CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));
 CHECK(poll(&out)==WN_OK&&out.team_deficit[0]&&out.team_deficit[1]);
 warmup_queue_owned_departed();CHECK(poll(&out)==WN_OK&&!out.team_deficit[0]&&!out.party_safety_verified);
 join_hold_until=0;CHECK(poll(&out)==WN_OK&&out.party_safety_verified);
 warmup_queue_guard_config(0);warmup_queue_guard_sync(0);CHECK(poll(&out)==WN_WAIT);
 setup(1);CHECK(qg_wrapper((void *)0x44000,(void *)0x80020,1));CHECK(native_calls==1);
 setup(1);test_view.native_team_allowance_known=0;CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);
 setup(1);test_reenter=1;CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1&&atomic_load(&reentries)==1);
 setup(1);pthread_t thread;CHECK(pthread_create(&thread,NULL,other_thread,NULL)==0);CHECK(pthread_join(thread,NULL)==0);CHECK(native_calls==0&&atomic_load(&thread_errors)==1);
 setup(1);party(0x80000,10,0x45000);CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==0);CHECK(poll(&out)==WN_OK&&out.valid&&out.team_deficit[0]==1&&out.team_deficit[1]==0&&!out.party_safety_verified&&out.inflight_slots==0);
 test_view.actual_gs_count--;test_view.team_total[0]--;test_view.removable_owned_team[0]--;CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);
 setup(1);test_view.actual_gs_count=100;test_view.team_total[0]=test_view.team_total[1]=50;CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(poll(&out)==WN_OK&&out.team_deficit[0]==1&&out.team_deficit[1]==0);
 setup(1);party(0x80000,10,0x45000);test_view.removable_owned_team[0]=test_view.removable_owned_team[1]=0;CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==0);
 setup(0);CHECK(poll(&out)==WN_OK&&out.valid&&out.party_safety_verified&&out.inflight_slots==0);
 int j=3;set(0x44000+0x2e8,&j,4);CHECK(poll(&out)==WN_OK&&out.valid&&!out.party_safety_verified&&out.inflight_slots==3);
 setup(1);party(0x80000,10,0x45000);CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));int zero=0;set(0x44000+0x2f8,&zero,4);CHECK(poll(&out)==WN_OK&&out.team_deficit[0]==0&&out.party_safety_verified);
 setup(1);party(0x80000,10,0x45000);CHECK(!qg_wrapper((void *)0x44000,(void *)0x80000,1));test_view.world_epoch++;CHECK(poll(&out)==WN_OK&&out.team_deficit[0]==0);
 setup(1);CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));test_armed=0;test_provider=0;test_outer++;CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==2);
 setup(1);int bad=0;set(0x30000+4*sizeof(struct qg_slot)+16,&bad,4);CHECK(qg_wrapper((void *)0x44000,(void *)0x80000,1));CHECK(native_calls==1);
 /* Planner lease must survive20ms/40ms phase boundaries. Fresh native
  * queue-view validation remains5ms and is never replaced by that lease. */
 setup(0);uint64_t before_lease=clock_ns();CHECK(poll(&out)==WN_OK&&out.valid);uint64_t after_lease=clock_ns();
 CHECK(out.valid_until_ns>=before_lease+UINT64_C(500000000));CHECK(out.valid_until_ns<=after_lease+UINT64_C(500000000));
 CHECK(before_lease+UINT64_C(20000000)<out.valid_until_ns);CHECK(before_lease+UINT64_C(40000000)<out.valid_until_ns);
 CHECK(after_lease+UINT64_C(600000000)>out.valid_until_ns);
 struct warmup_ue_queue_view stale=test_view;struct qg_table table;
 stale.outer_gt_epoch=test_outer;stale.captured_ns=clock_ns()-UINT64_C(6000000);CHECK(!view_ok(&stale,clock_ns(),&table));
 uint64_t fresh_now=clock_ns();stale.captured_ns=fresh_now;CHECK(view_ok(&stale,fresh_now,&table));
 struct wn_admission old_lease=out;int new_party=1;set(0x44000+0x2f8,&new_party,4);CHECK(poll(&out)==WN_OK&&out.valid&&!out.party_safety_verified);
 CHECK(old_lease.party_safety_verified&&clock_ns()<old_lease.valid_until_ns);
 int new_joining=1;set(0x44000+0x2e8,&new_joining,4);CHECK(poll(&out)==WN_OK&&out.inflight_slots==1&&!out.party_safety_verified);
 /* Real candidate02 reserve/allocated geometry, independent of fake counts.
  * 33 reserved chunks permit 2162688 slots while four chunks hold234936. */
 setup(0);struct qg_table real={0x20000,0,2162688,234936,33,4},readback;
 set(QG_TABLE,&real,sizeof real);CHECK(table_read(&readback));CHECK(poll(&out)==WN_OK&&out.valid&&out.party_safety_verified);
 const struct qg_table invalid[]={
  {0x20000,0,2162689,234936,33,4}, /* reservation exceeds pointer-table bound */
  {0x20000,0,4259840,234936,65,4}, /* exceeds64-chunk policy */
  {0x20000,0,2162688,262145,33,4}, /* object count needs a fifth chunk */
  {0x20000,0,2162688,196608,33,4}, /* advertised fourth chunk has no element */
  {0x20000,0,2162688,234936,33,3},
  {0x20000,0,2162688,234936,3,4},
  {0x20000,0,2162688,234936,33,0},
  {0x20000,0,2162688,234936,33,-1},
  {0x20000,0,2162688,0,33,4},
  {0x20000,0,2162688,-1,33,4},
  {0x20000,0,234935,234936,33,4},
  {0x20000,0,0,1,1,1},
  {0x20000,0,-1,1,1,1},
  {0x20000,0,65536,1,0,1},
  {0x20000,0,65536,1,-1,1},
  {0,0,2162688,234936,33,4},
  {0x20001,0,2162688,234936,33,4},
  {UINT64_C(0x800000000000),0,2162688,234936,33,4}
 };
 for(size_t i=0;i<sizeof invalid/sizeof invalid[0];i++){set(QG_TABLE,&invalid[i],sizeof invalid[i]);CHECK(!table_read(&readback));CHECK(poll(&out)==WN_OK&&out.valid&&atomic_load(&unknown));}
 struct qg_table full={0x20000,0,4194304,4194304,64,64};set(QG_TABLE,&full,sizeof full);CHECK(table_read(&readback));
 struct qg_table first={0x20000,0,65536,65536,1,1};set(QG_TABLE,&first,sizeof first);CHECK(table_read(&readback));
 struct qg_slot item;CHECK(!slot(&first,-1,&item));CHECK(!slot(&first,first.count,&item));
 struct qg_table wrong=first;wrong.count=65537;CHECK(!slot(&wrong,65536,&item));
 uint64_t misaligned_chunk=0x30001;set(0x20000,&misaligned_chunk,8);CHECK(!slot(&first,0,&item));
 for(uint32_t t=0;t<=100;t+=10)for(uint32_t o=0;o<=100-t;o+=10)for(int p=1;p<=12;p++){
  setup(0);test_view.actual_gs_count=t+o;test_view.team_total[0]=t;test_view.team_total[1]=o;test_view.removable_owned_team[0]=t<40?t:40;test_view.removable_owned_team[1]=o<40?o:40;
  int ok=removal_plan(&test_view,0,1,p,needed),best=161;
  for(uint32_t a=0;a<=test_view.removable_owned_team[0];a++)for(uint32_t b=0;b<=test_view.removable_owned_team[1];b++)if((int64_t)t+o+p-a-b<=100&&2*((int64_t)t-a+p)-100<=4&&(int64_t)t-a+p-((int64_t)o-b)<10&&(int)(a+b)<best)best=(int)(a+b);
  CHECK(ok==(best<=160));if(ok)CHECK((int)(needed[0]+needed[1])==best);
 }
 printf("{\"actual_guard_policy_checks\":%u,\"install_called\":false,\"original_gate_mocked\":true,\"game_SO_loaded\":false,\"UE_calls\":0}\n",assertions);return 0;
}
