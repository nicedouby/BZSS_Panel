/* Standalone fixture. Never calls install(), UE, auth, networking or a game SO. */
#include "warmup_admission.h"
#include "admission_plan.h"
#include "selector_preimage.generated.h"
#include <stdint.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
extern uint64_t fixture_native_score_step(int32_t,int32_t,int32_t,int32_t,int32_t,int32_t);
static unsigned checks;
#define CHECK(x) do{checks++;if(!(x)){fprintf(stderr,"check %u failed line%d: %s\n",checks,__LINE__,#x);exit(1);}}while(0)
struct team { int present;uint32_t flags;int count,weight; };
static int rank(const struct team teams[2],int x,int initial){
 int best=initial,selected=-1;
 for(int i=0;i<2;i++)if(teams[i].present&&!(teams[i].flags&UINT32_C(0x40000000))){
  uint64_t pair=fixture_native_score_step(teams[i].count,x+1,teams[i].weight,best,i+1,selected);
  best=(int32_t)pair;selected=(int32_t)(pair>>32);
 }
 return selected;
}
static int gate(int g,int j,int p,int maximum,int chosen,int other,int d){return (int64_t)g+j+p<=maximum&&2*((int64_t)chosen+p)-maximum<=d&&(int64_t)chosen+p-other<10;}
int main(void){
 unsigned char candidate[WARMUP_ADMISSION_SELECTOR_SIZE],bad[WARMUP_ADMISSION_SELECTOR_SIZE],untouched[WARMUP_ADMISSION_SELECTOR_SIZE];
 memset(untouched,0xa5,sizeof untouched);
 CHECK(warmup_admission_selector_size()==sizeof candidate);
 CHECK(warmup_admission_prepare(warmup_selector_preimage,sizeof candidate,candidate,sizeof candidate));
 CHECK(warmup_admission_is_candidate(candidate,sizeof candidate));
 unsigned changed=0;
 for(size_t i=0;i<sizeof candidate;i++)if(candidate[i]!=warmup_selector_preimage[i]){changed++;CHECK(i>=WARMUP_ADMISSION_PATCH_OFFSET&&i<WARMUP_ADMISSION_PATCH_OFFSET+4);}
 CHECK(changed==4);CHECK(candidate[WARMUP_ADMISSION_PATCH_OFFSET-2]==0x41&&candidate[WARMUP_ADMISSION_PATCH_OFFSET-1]==0xbc);
 CHECK(!warmup_admission_prepare(candidate,sizeof candidate,bad,sizeof bad));
 for(size_t i=0;i<sizeof bad;i++){
  memcpy(bad,warmup_selector_preimage,sizeof bad);bad[i]^=1;memset(candidate,0xa5,sizeof candidate);
  CHECK(!warmup_admission_prepare(bad,sizeof bad,candidate,sizeof candidate));CHECK(!memcmp(candidate,untouched,sizeof candidate));
 }
 CHECK(!warmup_admission_prepare(NULL,sizeof bad,candidate,sizeof candidate));
 CHECK(!warmup_admission_prepare(warmup_selector_preimage,sizeof bad-1,candidate,sizeof candidate));
 CHECK(!warmup_admission_prepare(warmup_selector_preimage,sizeof bad,candidate,sizeof candidate-1));
 /* Actual extracted imul/cdq/idiv/sub/cmp/cmov instructions versus an
  * independent widened-arithmetic oracle, including threshold/tie cases. */
 const int ns[]={0,1,9,10,25,26,40,41,80,100,4096};
 const int xs[]={0,1,2,3,79,80,81,100,4096};
 const int ws[]={0,1,50,100};
 const int bs[]={INT32_MIN,-10000,-999,-950,0,50,INT32_MAX};
 for(size_t a=0;a<sizeof ns/sizeof *ns;a++)for(size_t b=0;b<sizeof xs/sizeof *xs;b++)for(size_t c=0;c<sizeof ws/sizeof *ws;c++)for(size_t d=0;d<sizeof bs/sizeof *bs;d++){
  int score=ws[c]-(int)((int64_t)ns[a]*100/(xs[b]+1));
  uint64_t pair=fixture_native_score_step(ns[a],xs[b]+1,ws[c],bs[d],2,-1);
  CHECK((int32_t)pair==(score>bs[d]?score:bs[d]));CHECK((int32_t)(pair>>32)==(score>bs[d]?2:-1));
 }
 struct team t[2]={{1,0,40,50},{1,0,40,50}};
 CHECK(rank(t,0,-999)==-1);CHECK(rank(t,0,INT32_MIN)==1);CHECK(gate(0,0,1,100,40,40,0));
 for(int mask=0;mask<4;mask++){
  t[0]=(struct team){mask&1?0:1,mask&1?0:UINT32_C(0x40000000),40,50};
  t[1]=(struct team){mask&2?0:1,mask&2?0:UINT32_C(0x40000000),40,50};
  CHECK(rank(t,0,INT32_MIN)==-1);
 }
 t[0]=(struct team){0,0,40,50};t[1]=(struct team){1,0,40,50};CHECK(rank(t,0,INT32_MIN)==2);
 t[0]=(struct team){1,0,40,50};t[1]=(struct team){1,0,39,50};CHECK(rank(t,0,INT32_MIN)==2);
 const int hs[]={0,1,2,3,79,80,81};
 for(size_t i=0;i<sizeof hs/sizeof *hs;i++){
  int h=hs[i],b=h<80?80-h:0,total=h+b;
  t[0]=(struct team){1,0,(total+1)/2,50};t[1]=(struct team){1,0,total/2,50};
  int selected=rank(t,h,INT32_MIN);CHECK(selected==1||selected==2);
  CHECK(gate(h,0,1,100,t[selected-1].count,t[2-selected].count,0));
  if(h>=3)CHECK(selected==rank(t,h,-999));
 }
 /* Planner checked against a brute-force minimum over owned-only removals.
  * No test interprets a plan as authorization to Join. */
 for(int team=0;team<=100;team+=5)for(int other=0;other<=100;other+=5)for(int party=1;party<=20;party++)for(int owned=0;owned<=team;owned+=5){
  struct admission_snapshot s={0,0,party,100,team,other,owned,0};int32_t remove=-1;
  int result=warmup_admission_plan(&s,&remove),minimum=-1;
  for(int r=0;r<=owned;r++)if(gate(0,0,party,100,team-r,other,0)){minimum=r;break;}
  CHECK((minimum<0&&result==ADMISSION_OWNED_ROOM_UNAVAILABLE)||(minimum==0&&result==ADMISSION_ROOM_READY)||(minimum>0&&result==ADMISSION_REMOVE_OWNED_THEN_RECHECK));
  if(minimum>=0)CHECK(remove==minimum);
 }
 struct admission_snapshot s={0,0,10,100,40,40,40,0};int32_t remove;
 CHECK(!gate(0,0,10,100,40,40,0));CHECK(warmup_admission_plan(&s,&remove)==ADMISSION_REMOVE_OWNED_THEN_RECHECK&&remove==1);CHECK(gate(0,0,10,100,39,40,0));
 s.native_global_count=99;s.native_joining_count=1;s.party_size=1;CHECK(warmup_admission_plan(&s,&remove)==ADMISSION_REAL_CAPACITY_BLOCKED);
 s=(struct admission_snapshot){0,0,10,100,40,40,0,0};CHECK(warmup_admission_plan(&s,&remove)==ADMISSION_OWNED_ROOM_UNAVAILABLE);
 s.party_size=0;CHECK(warmup_admission_plan(&s,&remove)==ADMISSION_BAD_INPUT);
 printf("{\"checks_passed\":%u,\"actual_ELF_score_instructions_executed\":true,\"runtime_install_called\":false,\"game_library_loaded\":false,\"UE_calls\":0}\n",checks);
 return 0;
}
