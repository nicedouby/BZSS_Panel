#define _GNU_SOURCE
#include "sha256.h"
#ifdef NT_JOINT_WARMUP
#include "../integration/joint_control.h"
#include "../integration/joint_dispatch.h"
#endif
#ifdef NT_WITH_GRAPH
#include "native_graph.h"
#include "native_runtime.h"
#include "native_protocol.h"
#endif
#include <elf.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/random.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "This probe is only for the pinned Linux x86_64 ELF build"
#endif
_Static_assert(ATOMIC_LLONG_LOCK_FREE == 2, "callback counters must be lock-free");
_Static_assert(ATOMIC_POINTER_LOCK_FREE == 2, "callback pointers must be lock-free");

#define BUILD_SHA "86770cae6d030e37ab9e435e753e7e76ff59e6853190671627af771e02c148d5"
#define ENGINE_VPTR ((uintptr_t)0x2337bd8)
#define TICK_CELL ((uintptr_t)0x2337ee8)
#define ORIGINAL_TICK ((uintptr_t)0x7e93fe0)
#define ENGINE_GLOBAL ((uintptr_t)0xd708078)
#define CALLSITE ((uintptr_t)0x89b26b4)

typedef void (*tick_function)(void *, float, bool);
static tick_function original_tick;
static char report_path[PATH_MAX] = "/runtime/ticket-tick-probe.json";
static char session_id[33];
static pid_t process_id;
static _Atomic int state, patch_installed, last_io_error;
static _Atomic unsigned long long callback_count, matching_count, engine_mismatch, vptr_mismatch, thread_mismatch;
static _Atomic unsigned long long first_tid, last_tid, last_engine, last_gengine, last_vptr;
static _Atomic unsigned int last_delta_bits, last_idle;
#ifdef NT_WITH_GRAPH
static int graph_enabled;
static _Atomic unsigned long long graph_last_ns, graph_max_ns, graph_slow_count;
#define COUNT_ONLY (graph_enabled ? "false" : "true")
#else
#define COUNT_ONLY "true"
#endif

/* Only this constructor changes the vtable, before the game main loop starts. */
enum probe_state {
 P_STARTING, P_READY, P_BAD_PATH, P_RANDOM_FAILED, P_EXE_OPEN_FAILED,
 P_ELF_MISMATCH, P_SHA_MISMATCH, P_SEGMENT_MISMATCH, P_CODE_MISMATCH,
 P_SLOT_MISMATCH, P_WORKER_FAILED, P_MPROTECT_FAILED, P_SLOT_RACE,
 P_RESTORE_FAILED
};
static const char *state_name(int s) {
 static const char *const names[] = {"starting","ready","invalid_report_path","session_random_failed","executable_open_failed","elf_mismatch","sha256_mismatch","segment_mismatch","code_fingerprint_mismatch","original_slot_mismatch","worker_start_failed","mprotect_failed","slot_changed_during_install","page_protection_restore_failed"};
 return s >= 0 && (size_t)s < sizeof(names)/sizeof(names[0]) ? names[s] : "invalid_state";
}
static double wall_time(void) { struct timespec t; if(clock_gettime(CLOCK_REALTIME,&t))return 0;return (double)t.tv_sec+(double)t.tv_nsec/1e9; }
static int write_all(int fd,const char *p,size_t n) {while(n){ssize_t r=write(fd,p,n);if(r<0&&errno==EINTR)continue;if(r<=0)return -1;p+=r;n-=(size_t)r;}return 0;}

static void *report_worker(void *unused) {
 (void)unused;
 for(;;){
  char body[8192],temp[PATH_MAX];
  int n=snprintf(body,sizeof body,"{\"schema\":1,\"mode\":\"native_tick_probe\",\"build_sha256\":\"%s\",\"session_id\":\"%s\",\"state\":\"%s\",\"patch_installed\":%s,\"pid\":%ld,\"observed_at\":%.6f,\"callbacks\":%llu,\"matching_callbacks\":%llu,\"first_tid\":%llu,\"last_tid\":%llu,\"engine\":\"0x%llx\",\"gengine\":\"0x%llx\",\"vptr\":\"0x%llx\",\"engine_mismatches\":%llu,\"vptr_mismatches\":%llu,\"thread_mismatches\":%llu,\"last_delta_float_bits\":%u,\"last_idle\":%u,\"last_io_errno\":%d,\"count_only\":%s}\n",
   BUILD_SHA,session_id,state_name(atomic_load(&state)),atomic_load(&patch_installed)?"true":"false",(long)process_id,wall_time(),atomic_load(&callback_count),atomic_load(&matching_count),atomic_load(&first_tid),atomic_load(&last_tid),atomic_load(&last_engine),atomic_load(&last_gengine),atomic_load(&last_vptr),atomic_load(&engine_mismatch),atomic_load(&vptr_mismatch),atomic_load(&thread_mismatch),atomic_load(&last_delta_bits),atomic_load(&last_idle),atomic_load(&last_io_error),COUNT_ONLY);
#ifdef NT_WITH_GRAPH
  if(n>1&&(size_t)n<sizeof body){
   struct nt_snapshot snapshot;
   nt_runtime_copy_snapshot(&snapshot);
   char graph_json[NT_REPLY_MAX];
   int graph_size=nt_format_status(graph_json,sizeof graph_json,session_id,&snapshot);
   if(graph_size<0)strcpy(graph_json,"null");
   n-=2; /* Replace the closing brace/newline with the graph probe fields. */
   int extra=snprintf(body+n,sizeof body-(size_t)n,",\"graph_enabled\":%s,\"writes_enabled\":%s,\"applied_operations\":%llu,\"runtime_state\":\"%s\",\"graph_last_ns\":%llu,\"graph_max_ns\":%llu,\"graph_slow_count\":%llu,\"graph_snapshot\":%s}\n",graph_enabled?"true":"false",nt_runtime_writes_enabled()?"true":"false",nt_runtime_applied_count(),nt_runtime_state(),atomic_load(&graph_last_ns),atomic_load(&graph_max_ns),atomic_load(&graph_slow_count),graph_json);
   if(extra<0||(size_t)extra>=sizeof body-(size_t)n)n=-1;
   else n+=extra;
  }
#endif
  int t=snprintf(temp,sizeof temp,"%s.tmp.%ld",report_path,(long)process_id);
  if(n>0&&(size_t)n<sizeof body&&t>0&&(size_t)t<sizeof temp){
   int fd=open(temp,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600);
   if(fd>=0){
    int ok=write_all(fd,body,(size_t)n),saved=errno;
    if(close(fd)&&ok==0){ok=-1;saved=errno;}
    if(ok==0&&rename(temp,report_path)==0)atomic_store(&last_io_error,0);
    else {if(ok==0)saved=errno;unlink(temp);atomic_store(&last_io_error,saved);}
   }else atomic_store(&last_io_error,errno);
  }
  struct timespec delay={1,0};while(nanosleep(&delay,&delay)&&errno==EINTR){}
 }
 return NULL;
}

/* SysV ABI: RDI=this, XMM0=float, ESI/SIL=bool. Forward once, unchanged. */
#ifdef NT_JOINT_WARMUP
static void ticket_after_tick(void *engine,float delta_seconds,bool idle_mode) {
#else
static void tick_callback(void *engine,float delta_seconds,bool idle_mode) {
 original_tick(engine,delta_seconds,idle_mode);
#endif
 unsigned long long tid=(unsigned long long)syscall(SYS_gettid),zero=0;
 atomic_fetch_add_explicit(&callback_count,1,memory_order_relaxed);
 atomic_compare_exchange_strong_explicit(&first_tid,&zero,tid,memory_order_relaxed,memory_order_relaxed);
 if(atomic_load_explicit(&first_tid,memory_order_relaxed)!=tid)atomic_fetch_add_explicit(&thread_mismatch,1,memory_order_relaxed);
 atomic_store_explicit(&last_tid,tid,memory_order_relaxed);
 atomic_store_explicit(&last_engine,(uintptr_t)engine,memory_order_relaxed);
 uintptr_t current=__atomic_load_n((uintptr_t *)ENGINE_GLOBAL,__ATOMIC_RELAXED);
 atomic_store_explicit(&last_gengine,current,memory_order_relaxed);
 unsigned int bits;memcpy(&bits,&delta_seconds,sizeof bits);
 atomic_store_explicit(&last_delta_bits,bits,memory_order_relaxed);
 atomic_store_explicit(&last_idle,idle_mode?1U:0U,memory_order_relaxed);
 if(!engine||(uintptr_t)engine!=current){atomic_fetch_add_explicit(&engine_mismatch,1,memory_order_relaxed);return;}
 uintptr_t vptr=__atomic_load_n((uintptr_t *)engine,__ATOMIC_RELAXED);
 atomic_store_explicit(&last_vptr,vptr,memory_order_relaxed);
 if(vptr!=ENGINE_VPTR){atomic_fetch_add_explicit(&vptr_mismatch,1,memory_order_relaxed);return;}
 atomic_fetch_add_explicit(&matching_count,1,memory_order_relaxed);
#ifdef NT_WITH_GRAPH
 if(graph_enabled&&atomic_load_explicit(&state,memory_order_relaxed)==P_READY&&tid==(unsigned long long)process_id){
  struct timespec before,after;
  struct nt_snapshot snapshot;
  clock_gettime(CLOCK_MONOTONIC,&before);
  nt_graph_tick(session_id,&snapshot);
  clock_gettime(CLOCK_MONOTONIC,&after);
  int64_t measured=((int64_t)after.tv_sec-(int64_t)before.tv_sec)*1000000000LL+(int64_t)after.tv_nsec-(int64_t)before.tv_nsec;
  unsigned long long elapsed=measured>0?(unsigned long long)measured:0;
  atomic_store_explicit(&graph_last_ns,elapsed,memory_order_relaxed);
  unsigned long long max=atomic_load_explicit(&graph_max_ns,memory_order_relaxed);
  while(elapsed>max&&!atomic_compare_exchange_weak_explicit(&graph_max_ns,&max,elapsed,memory_order_relaxed,memory_order_relaxed)){}
  if(elapsed>10000000ULL)atomic_fetch_add_explicit(&graph_slow_count,1,memory_order_relaxed);
  nt_runtime_on_tick(&snapshot);
 }
#endif
}

#ifdef NT_JOINT_WARMUP
static void tick_callback(void *engine,float delta_seconds,bool idle_mode) {
 joint_tick_dispatch(engine,delta_seconds,idle_mode,warmup_control_tick_enter,
                     original_tick,ticket_after_tick,warmup_control_after_tick);
}
static void joint_fatal(const char *why) {
 fprintf(stderr,"squad joint native startup: %s\n",why);_exit(125);
}
#endif

/* Require exact file-backed segment protections and zero relocation base. */
static int segment_has(const Elf64_Phdr *p,size_t n,uintptr_t a,size_t bytes,unsigned flags) {
 for(size_t i=0;i<n;i++)if(p[i].p_type==PT_LOAD&&p[i].p_flags==flags&&a>=p[i].p_vaddr&&bytes<=p[i].p_memsz&&a-p[i].p_vaddr<=p[i].p_memsz-bytes)return 1;
 return 0;
}
static int pread_exact(int fd,void *buf,size_t n,off_t at){unsigned char *p=buf;while(n){ssize_t r=pread(fd,p,n,at);if(r<0&&errno==EINTR)continue;if(r<=0)return -1;p+=r;n-=(size_t)r;at+=r;}return 0;}
static int preflight(void) {
 int fd=open("/proc/self/exe",O_RDONLY|O_CLOEXEC);if(fd<0)return P_EXE_OPEN_FAILED;
 Elf64_Ehdr eh;Elf64_Phdr ph[64];
 if(pread_exact(fd,&eh,sizeof eh,0)||memcmp(eh.e_ident,ELFMAG,SELFMAG)||eh.e_ident[EI_CLASS]!=ELFCLASS64||eh.e_ident[EI_DATA]!=ELFDATA2LSB||eh.e_type!=ET_EXEC||eh.e_machine!=EM_X86_64||eh.e_phentsize!=sizeof(Elf64_Phdr)||!eh.e_phnum||eh.e_phnum>64||pread_exact(fd,ph,eh.e_phnum*sizeof *ph,(off_t)eh.e_phoff)){close(fd);return P_ELF_MISMATCH;}
 nt_sha256 sha;unsigned char buf[16384],digest[32];char hex[65];static const char hexdigits[]="0123456789abcdef";nt_sha256_init(&sha);
 for(;;){ssize_t n=read(fd,buf,sizeof buf);if(n<0&&errno==EINTR)continue;if(n<0){close(fd);return P_EXE_OPEN_FAILED;}if(!n)break;nt_sha256_update(&sha,buf,(size_t)n);}close(fd);nt_sha256_final(&sha,digest);
 for(size_t i=0;i<32;i++){hex[i*2]=hexdigits[digest[i]>>4];hex[i*2+1]=hexdigits[digest[i]&15];}hex[64]=0;
 if(strcmp(hex,BUILD_SHA))return P_SHA_MISMATCH;
 if(!segment_has(ph,eh.e_phnum,TICK_CELL,sizeof(uintptr_t),PF_R)||!segment_has(ph,eh.e_phnum,ENGINE_VPTR,sizeof(uintptr_t),PF_R)||!segment_has(ph,eh.e_phnum,ORIGINAL_TICK,32,PF_R|PF_X)||!segment_has(ph,eh.e_phnum,CALLSITE,30,PF_R|PF_X)||!segment_has(ph,eh.e_phnum,ENGINE_GLOBAL,sizeof(uintptr_t),PF_R|PF_W))return P_SEGMENT_MISMATCH;
 static const unsigned char tick_code[32]={0x55,0x41,0x57,0x41,0x56,0x41,0x55,0x41,0x54,0x53,0x48,0x81,0xec,0x98,0x00,0x00,0x00,0x41,0x89,0xf6,0xf3,0x0f,0x11,0x04,0x24,0x48,0x89,0xfb,0xbf,0x69,0x76,0x34};
 static const unsigned char call_code[30]={0x48,0x8b,0x3d,0xbd,0x59,0xd5,0x04,0xf2,0x0f,0x10,0x05,0x55,0x53,0xa4,0x04,0xf2,0x0f,0x5a,0xc0,0x48,0x8b,0x07,0x31,0xf6,0xff,0x90,0x10,0x03,0x00,0x00};
 if(memcmp((const void *)ORIGINAL_TICK,tick_code,sizeof tick_code)||memcmp((const void *)CALLSITE,call_code,sizeof call_code))return P_CODE_MISMATCH;
 if(__atomic_load_n((uintptr_t *)TICK_CELL,__ATOMIC_ACQUIRE)!=ORIGINAL_TICK)return P_SLOT_MISMATCH;
 /* The instance pointer may still be null in a preload constructor. */
 return P_READY;
}

#ifdef NT_JOINT_WARMUP
#define PROBE_RETURN_ERROR(code) do{atomic_store(&state,(code));joint_fatal(state_name(code));}while(0)
#else
#define PROBE_RETURN_ERROR(code) do{atomic_store(&state,(code));return;}while(0)
#endif

__attribute__((constructor)) static void install_probe(void) {
 const char *enabled=getenv("TICKET_NATIVE_PROBE_ENABLE");
#ifdef NT_JOINT_WARMUP
 const char *population=getenv("WARMUP_INTEGRATED_ENABLE");
 if(!enabled||strcmp(enabled,"1")||!population||strcmp(population,"1")||!warmup_control_joint_prepared())joint_fatal("joint_enable_or_warmup_prepare_rejected");
#else
 if(!enabled||strcmp(enabled,"1"))return;
#endif
 process_id=getpid();
 const char *path=getenv("TICKET_NATIVE_PROBE_REPORT");
 if(path){size_t n=strlen(path);if(!n||n>=sizeof report_path||path[0]!='/'){PROBE_RETURN_ERROR(P_BAD_PATH);}memcpy(report_path,path,n+1);}
 unsigned char random[16];size_t done=0;
 while(done<sizeof random){ssize_t n=getrandom(random+done,sizeof random-done,0);if(n<0&&errno==EINTR)continue;if(n<=0){PROBE_RETURN_ERROR(P_RANDOM_FAILED);}done+=(size_t)n;}
 static const char digits[]="0123456789abcdef";for(size_t i=0;i<sizeof random;i++){session_id[i*2]=digits[random[i]>>4];session_id[i*2+1]=digits[random[i]&15];}session_id[32]=0;
 int checked=preflight();atomic_store(&state,checked);
 if(checked!=P_READY){
#ifdef NT_JOINT_WARMUP
  joint_fatal(state_name(checked));
#else
  return;
#endif
 }
 unsetenv("LD_PRELOAD"); /* Only the verified game keeps the injected library. */
#ifdef NT_WITH_GRAPH
 const char *graph=getenv("TICKET_NATIVE_GRAPH_ENABLE");
 graph_enabled=graph&&!strcmp(graph,"1")&&nt_graph_init();
#ifdef NT_JOINT_WARMUP
 if(!graph_enabled)joint_fatal("ticket_graph_prepare_failed");
#else
 if(graph_enabled)nt_runtime_start(session_id);
#endif
#endif
#ifndef NT_JOINT_WARMUP
 pthread_t worker;
 if(pthread_create(&worker,NULL,report_worker,NULL)){atomic_store(&state,P_WORKER_FAILED);return;}
 pthread_detach(worker);
#endif
 long page_size=sysconf(_SC_PAGESIZE);
 if(page_size<=0||(page_size&(page_size-1))){PROBE_RETURN_ERROR(P_MPROTECT_FAILED);}
 uintptr_t page=TICK_CELL&~((uintptr_t)page_size-1);
 original_tick=(tick_function)ORIGINAL_TICK;
 if(mprotect((void *)page,(size_t)page_size,PROT_READ|PROT_WRITE)){PROBE_RETURN_ERROR(P_MPROTECT_FAILED);}
 uintptr_t expected=ORIGINAL_TICK;
 bool changed=__atomic_compare_exchange_n((uintptr_t *)TICK_CELL,&expected,(uintptr_t)tick_callback,false,__ATOMIC_RELEASE,__ATOMIC_RELAXED);
 if(!changed)atomic_store(&state,P_SLOT_RACE);
 else atomic_store(&patch_installed,1);
 if(mprotect((void *)page,(size_t)page_size,PROT_READ)){
  /* Slot remains callable and forwards once; report the restore failure. */
  atomic_store(&state,P_RESTORE_FAILED);
 }
#ifdef NT_JOINT_WARMUP
 if(!changed||atomic_load(&state)!=P_READY)joint_fatal(state_name(atomic_load(&state)));
 warmup_control_joint_tick_installed();
 /* Every exact-ELF/slot/callsite/target check has finished. Workers start now. */
 if(!nt_runtime_start(session_id))joint_fatal("ticket_runtime_start_failed");
 pthread_t worker;
 if(pthread_create(&worker,NULL,report_worker,NULL))joint_fatal("ticket_report_worker_failed");
 if(pthread_detach(worker))joint_fatal("ticket_report_detach_failed");
 if(!warmup_control_joint_start_worker())joint_fatal("warmup_worker_start_failed");
#endif
}
