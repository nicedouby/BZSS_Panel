/* Standalone policy/locking test, no game library or engine calls.
 * Linux: cc -std=c11 -O2 -Wall -Wextra -Werror -pthread test_snapshot.c -o test_snapshot */
#include "warmup_native_snapshot.c"
#include <assert.h>
#include <pthread.h>
#include <stdio.h>
static int live_ok=1;
static int live(const struct warmup_native_snapshot_v1 *s){return live_ok&&s->game_mode.serial==3;}
static struct warmup_native_snapshot_v1 valid(uint64_t revision,uint64_t epoch){
 struct warmup_native_snapshot_v1 s={0};s.abi_version=1;s.struct_size=sizeof s;s.revision=revision;s.world_epoch=epoch;s.captured_ns=1000;s.valid_until_ns=2000;
 s.world=(struct warmup_native_weak_v1){0x10000,1,1};s.game_state=(struct warmup_native_weak_v1){0x20000,2,2};s.game_mode=(struct warmup_native_weak_v1){0x30000,3,3};s.game_session=(struct warmup_native_weak_v1){0x40000,4,4};
 s.H_total=s.B_actual=1;s.h_team[0]=s.owned_team[1]=1;s.team_total[0]=s.team_total[1]=1;s.target=2;s.desired=1;s.capacity=100;s.flags=WARMUP_SNAPSHOT_VALID|WARMUP_SNAPSHOT_BASELINE_READY;return s;
}
static void *other_thread(void *unused){(void)unused;struct warmup_native_snapshot_v1 out;assert(!warmup_native_snapshot_read(&out,1500));return NULL;}
int main(void){
 struct warmup_native_snapshot_v1 s=valid(1,1),out,bad;assert(warmup_native_snapshot_bind_validator(live));assert(!warmup_native_snapshot_bind_validator(live));assert(warmup_native_snapshot_seal(&s));assert(warmup_native_snapshot_read(&out,1500));
 live_ok=0;assert(!warmup_native_snapshot_read(&out,1500));live_ok=1;
 assert(!atomic_flag_test_and_set_explicit(&snapshot_lock,memory_order_acquire));assert(!warmup_native_snapshot_read(&out,1500));assert(!warmup_native_snapshot_invalidate(2,WARMUP_SNAPSHOT_MUTATION_INFLIGHT));assert(!warmup_native_snapshot_seal(&s));atomic_flag_clear_explicit(&snapshot_lock,memory_order_release);
 assert(warmup_native_snapshot_read(&out,1500));assert(!warmup_native_snapshot_read(&out,999));assert(!warmup_native_snapshot_read(&out,2000));assert(!warmup_native_snapshot_read(&out,0));
 pthread_t thread;assert(!pthread_create(&thread,NULL,other_thread,NULL));assert(!pthread_join(thread,NULL));
 assert(warmup_native_snapshot_invalidate(2,WARMUP_SNAPSHOT_WORLD_RESET));assert(!warmup_native_snapshot_read(&out,1500));s=valid(2,1);assert(!warmup_native_snapshot_seal(&s));s=valid(2,2);assert(warmup_native_snapshot_seal(&s));assert(!warmup_native_snapshot_invalidate(1,0));assert(warmup_native_snapshot_read(&out,1500));assert(!warmup_native_snapshot_seal(&s));assert(!warmup_native_snapshot_invalidate(2,WARMUP_SNAPSHOT_VALID));
 for(int which=0;which<12;which++){
  bad=valid(3,2);
  if(which==0)bad.h_team[0]=UINT32_MAX;else if(which==1)bad.h_unassigned=UINT32_MAX;else if(which==2)bad.owned_team[1]=UINT32_MAX;else if(which==3)bad.inflight_slots=UINT32_MAX;else if(which==4)bad.valid_until_ns=bad.captured_ns+UINT64_C(2000000001);else if(which==5)bad.world.address=UINT64_C(0x0000800000000000);else if(which==6)bad.game_mode.serial=0;else if(which==7)bad.game_session.address++;else if(which==8)bad.H_total=UINT32_MAX;else if(which==9){bad.owned_team[0]=UINT32_C(0x80000000);bad.owned_team[1]=UINT32_C(0x80000001);}else if(which==10)bad.capacity=101;else bad.flags|=UINT32_C(0x80000000);
  assert(!warmup_native_snapshot_seal(&bad));
 }
 s=valid(3,2);assert(warmup_native_snapshot_seal(&s));assert(warmup_native_snapshot_read(&out,1500));
 const uint32_t counts[]={80,99};uint64_t revision=4;
 for(size_t i=0;i<sizeof counts/sizeof counts[0];i++)for(unsigned team=0;team<2;team++){
  s=valid(revision++,2);s.H_total=0;s.h_team[0]=0;s.B_actual=s.target=s.desired=counts[i];
  s.owned_team[0]=s.owned_team[1]=s.team_total[0]=s.team_total[1]=0;
  s.owned_team[team]=s.team_total[team]=counts[i];
  assert(warmup_native_snapshot_seal(&s));assert(warmup_native_snapshot_read(&out,1500));
  assert(out.B_actual==counts[i]&&out.owned_team[team]==counts[i]&&out.target==counts[i]&&out.desired==counts[i]);
 }
 for(int which=0;which<3;which++){
  bad=s;bad.revision=revision;
  if(which==0)bad.B_actual=bad.owned_team[1]=bad.team_total[1]=100;else if(which==1)bad.target=100;else bad.desired=100;
  assert(!warmup_native_snapshot_seal(&bad));assert(warmup_native_snapshot_read(&out,1500));assert(out.revision==s.revision&&out.B_actual==99);
 }
 puts("snapshot bounds/freshness/epoch/revision/nonblocking/live/main-thread checks passed");return 0;
}
