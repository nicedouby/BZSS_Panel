/* Root-written request mailbox. Worker does IO; only GT touches UE objects. */
#include "identity_recovery.h"
static pthread_mutex_t ir_lock=PTHREAD_MUTEX_INITIALIZER;
static struct ir_request ir_mailbox;
static struct ir_report ir_result;
static char ir_seen[33];
static int ir_pending,ir_running;

static void ir_worker(void){
 char body[16384];size_t length=0;
 if(read_root_file(WC_BASE "/identity-recovery.request",body,sizeof body,&length)==1){
  struct ir_request r={0};int used=0;unsigned count=0;
  int parsed=sscanf(body,"%32[0-9a-f] %" SCNu64 " %" SCNu64 " %" SCNu64 " %" SCNu64 " %u%n",
      r.operation,&r.pid,&r.start_ticks,&r.world,&r.gs,&count,&used);
  int okay=parsed==6&&strlen(r.operation)==32&&r.pid==(uint64_t)process_id&&r.start_ticks==start_ticks&&count>0&&count<=99;
  r.count=count;
  for(unsigned i=0;okay&&i<count;i++){
   struct ir_target *v=&r.targets[i];int n=0;
   okay=sscanf(body+used," %" SCNu64 " %" SCNd32 " %" SCNd32 " %" SCNu64 "%n",&v->address,&v->index,&v->serial,&v->team,&n)==4&&n>0&&v->address>=0x10000&&v->index>=0&&v->serial>0&&v->team>=0x10000;
   used+=n;
   for(unsigned j=0;j<i;j++)if(r.targets[j].address==v->address||r.targets[j].index==v->index)okay=0;
  }
  while(okay&&(size_t)used<length&&(body[used]=='\n'||body[used]==' '||body[used]=='\r'||body[used]=='\t'))used++;
  okay=okay&&(size_t)used==length;
  if(okay){pthread_mutex_lock(&ir_lock);
   if(!ir_pending&&!ir_running&&strcmp(ir_seen,r.operation)){
    ir_mailbox=r;strcpy(ir_seen,r.operation);ir_result=(struct ir_report){0};ir_pending=1;
   }
   pthread_mutex_unlock(&ir_lock);
  }
 }
 struct ir_report result;struct ir_request req;int pending,running;
 pthread_mutex_lock(&ir_lock);result=ir_result;req=ir_mailbox;pending=ir_pending;running=ir_running;pthread_mutex_unlock(&ir_lock);
 if(!req.operation[0])return;
 char report[512];int size=snprintf(report,sizeof report,
  "{\"operation_id\":\"%s\",\"pid\":%ld,\"stage\":%d,\"error\":%d,\"pending\":%d,\"running\":%d,\"done\":%u,\"count\":%u,\"calls\":%u}\n",
  req.operation,(long)process_id,result.stage,result.error,pending,running,result.done,req.count,result.calls);
 if(size<=0||(size_t)size>=sizeof report)return;
 int fd=open(WC_STATE "/identity-recovery.tmp",O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW|O_CLOEXEC,0600);
 if(fd<0)return;
 int okay=write_all(fd,report,(size_t)size)&&fsync(fd)==0;close(fd);
 if(okay)(void)rename(WC_STATE "/identity-recovery.tmp",WC_STATE "/identity-recovery.json");
}

/* Return true while the ordinary pool must yield to recovery. */
static int ir_gt(const struct wc_config *cfg){
 if(pthread_mutex_trylock(&ir_lock))return 1;
 if(ir_pending){
  int clean_slots=1;for(unsigned i=0;i<WN_MAX_OWNED;i++)if(pool.owned[i].state!=WN_FREE)clean_slots=0;
  if(!cfg->revision||cfg->enabled||cfg->values.target||pool.config.target||!clean_slots||pool.action!=WU_NOOP||warmup_control_failed()){
   ir_result=(struct ir_report){.stage=-40,.error=40};ir_pending=0;
  }else if(!warmup_recovery_begin(&ir_mailbox)){
   ir_result=(struct ir_report){.stage=-41,.error=41};ir_pending=0;
  }else{ir_pending=0;ir_running=1;}
 }
 int run=ir_running;
 pthread_mutex_unlock(&ir_lock);
 if(!run)return 0;
 struct ir_report result;
 if(cfg->enabled||cfg->values.target||pool.config.target)result=(struct ir_report){.stage=-42,.error=42};
 else warmup_recovery_tick(&result);
 pthread_mutex_lock(&ir_lock);ir_result=result;if(result.stage<0||result.stage==3)ir_running=0;pthread_mutex_unlock(&ir_lock);
 return 1;
}
