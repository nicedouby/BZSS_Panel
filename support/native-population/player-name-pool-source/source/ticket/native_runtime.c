#define _GNU_SOURCE
#include "native_runtime.h"
#include "native_protocol.h"
#include "sha256.h"
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define RUNTIME_DIR "/run/squad-native"
#define SOCKET_PATH RUNTIME_DIR "/tickets.sock"
#define JOURNAL_DIR "/var/lib/squad-native"
#define JOURNAL_PATH JOURNAL_DIR "/tickets.journal"
#define MAX_OPERATIONS 2048
#define JOURNAL_MAX_BYTES (32U*1024U*1024U)
#define DEADLINE_NS 2000000000ULL
#define PUBLISH_NS 500000000ULL

enum runtime_state { R_STARTING,R_READY,R_PEER_REQUIRED,R_DIRECTORY_FAILED,R_JOURNAL_FAILED,R_SOCKET_FAILED,R_THREAD_FAILED };
enum mailbox_state { M_EMPTY,M_READY,M_RUNNING,M_DONE };
enum ledger_state { L_PENDING,L_FINAL,L_INTERRUPTED };
struct entry { struct nt_request request;char fingerprint[65];int state;char reply[NT_REPLY_MAX]; };
/* Fixed-size, zero-initialized records include a checksum over every preceding byte. */
struct journal_record {
 char magic[8];uint32_t version,type;
 struct nt_request request;
 char fingerprint[65];char reply[NT_REPLY_MAX];
 unsigned char checksum[32];
};
struct mailbox {
 struct nt_request request;uint64_t deadline;
 int result;struct nt_snapshot before,after;char reason[65];
};
static _Atomic int runtime_status,mail_state;
static _Atomic unsigned long long applied_count;
static pthread_mutex_t snapshot_lock=PTHREAD_MUTEX_INITIALIZER;
static struct nt_snapshot published;
static uint64_t next_publish;
static struct mailbox box;
static struct entry ledger[MAX_OPERATIONS];
static size_t ledger_count;
static char session_id[33];
static uid_t allowed_uid;
static gid_t socket_gid=(gid_t)-1;
static int allow_writes,journal_fd=-1,listen_fd=-1;

static uint64_t monotonic_ns(void){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (uint64_t)t.tv_sec*1000000000ULL+(uint64_t)t.tv_nsec;}
static double realtime_now(void){struct timespec t;if(clock_gettime(CLOCK_REALTIME,&t))return 0;return (double)t.tv_sec+(double)t.tv_nsec/1e9;}
static int write_all(int fd,const void *data,size_t n){const unsigned char *p=data;while(n){ssize_t k=write(fd,p,n);if(k<0&&errno==EINTR)continue;if(k<=0)return 0;p+=k;n-=(size_t)k;}return 1;}
static void unavailable(struct nt_snapshot *s,const char *reason){memset(s,0,sizeof *s);s->observed_at=realtime_now();snprintf(s->reason,sizeof s->reason,"%s",reason);}
const char *nt_runtime_state(void){static const char *const names[]={"starting","ready","peer_uid_required","runtime_directory_unavailable","journal_unavailable","socket_unavailable","runtime_thread_failed"};int s=atomic_load(&runtime_status);return s>=0&&(size_t)s<sizeof names/sizeof names[0]?names[s]:"runtime_invalid_state";}
int nt_runtime_writes_enabled(void){return allow_writes;}
unsigned long long nt_runtime_applied_count(void){return atomic_load(&applied_count);}
int nt_runtime_copy_snapshot(struct nt_snapshot *out){
 pthread_mutex_lock(&snapshot_lock);
 *out=published;
 pthread_mutex_unlock(&snapshot_lock);
 if(!out->observed_at){unavailable(out,"awaiting_game_thread");return 0;}
 if(realtime_now()-out->observed_at>2.0){unavailable(out,"game_thread_stale");return 0;}
 return 1;
}

void nt_runtime_on_tick(const struct nt_snapshot *s){
 uint64_t now=monotonic_ns();
 if(now>=next_publish&&pthread_mutex_trylock(&snapshot_lock)==0){published=*s;pthread_mutex_unlock(&snapshot_lock);next_publish=now+PUBLISH_NS;}
 if(atomic_load_explicit(&mail_state,memory_order_acquire)!=M_READY)return;
 atomic_store_explicit(&mail_state,M_RUNNING,memory_order_relaxed);
 memset(&box.before,0,sizeof box.before);memset(&box.after,0,sizeof box.after);box.reason[0]=0;
 if(!allow_writes){box.result=0;strcpy(box.reason,"native_writes_disabled");}
 else if(!now||now>=box.deadline){box.result=0;strcpy(box.reason,"request_expired");}
 else box.result=nt_graph_apply(box.request.expected_epoch,box.request.team1,box.request.team2,&box.before,&box.after,box.reason);
 if(box.result==1){
  atomic_fetch_add_explicit(&applied_count,1,memory_order_relaxed);
  if(pthread_mutex_trylock(&snapshot_lock)==0){published=box.after;pthread_mutex_unlock(&snapshot_lock);next_publish=now+PUBLISH_NS;}
 }
 atomic_store_explicit(&mail_state,M_DONE,memory_order_release);
}

static struct entry *find_entry(const char *id){for(size_t i=0;i<ledger_count;i++)if(!strcmp(ledger[i].request.operation_id,id))return &ledger[i];return NULL;}
static void record_checksum(struct journal_record *r,unsigned char out[32]){nt_sha256 hash;nt_sha256_init(&hash);nt_sha256_update(&hash,r,offsetof(struct journal_record,checksum));nt_sha256_final(&hash,out);}
static int journal_append(unsigned type,const struct entry *entry){
 struct stat st;if(journal_fd<0||fstat(journal_fd,&st)||st.st_size<0||(uint64_t)st.st_size+sizeof(struct journal_record)>JOURNAL_MAX_BYTES)return 0;
 struct journal_record record;memset(&record,0,sizeof record);memcpy(record.magic,"NTJNL001",8);record.version=1;record.type=type;record.request=entry->request;memcpy(record.fingerprint,entry->fingerprint,sizeof record.fingerprint);if(type==2)memcpy(record.reply,entry->reply,sizeof record.reply);record_checksum(&record,record.checksum);
 if(!write_all(journal_fd,&record,sizeof record)||fsync(journal_fd))return 0;
 return 1;
}
static int journal_open(void){
 int state_directory=open(JOURNAL_DIR,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);
 struct stat directory_stat;
 if(state_directory<0||fstat(state_directory,&directory_stat)||!S_ISDIR(directory_stat.st_mode)||directory_stat.st_uid!=getuid()||(directory_stat.st_mode&0002)){
  if(state_directory>=0)close(state_directory);
  return 0;
 }
 close(state_directory);
 journal_fd=open(JOURNAL_PATH,O_RDWR|O_APPEND|O_CREAT|O_CLOEXEC|O_NOFOLLOW,0600);
 struct stat st;if(journal_fd<0||flock(journal_fd,LOCK_EX|LOCK_NB)||fstat(journal_fd,&st)||!S_ISREG(st.st_mode)||st.st_uid!=getuid()||st.st_nlink!=1||(st.st_mode&077)||st.st_size<0||(uint64_t)st.st_size>JOURNAL_MAX_BYTES||(uint64_t)st.st_size%sizeof(struct journal_record))return 0;
 off_t pos=0;
 while(pos<st.st_size){
  struct journal_record r;unsigned char checksum[32];
  if(pread(journal_fd,&r,sizeof r,pos)!=(ssize_t)sizeof r)return 0;
  pos+=(off_t)sizeof r;
  record_checksum(&r,checksum);
  if(memcmp(r.magic,"NTJNL001",8)||r.version!=1||(r.type!=1&&r.type!=2)||memcmp(checksum,r.checksum,32)||!memchr(r.request.operation_id,0,sizeof r.request.operation_id)||!nt_hex_string(r.request.operation_id,32)||!memchr(r.request.expected_epoch,0,sizeof r.request.expected_epoch)||!r.request.expected_epoch[0]||!memchr(r.fingerprint,0,sizeof r.fingerprint)||!nt_hex_string(r.fingerprint,64)||!memchr(r.reply,0,sizeof r.reply))return 0;
  char expected_fingerprint[65];nt_request_fingerprint(&r.request,expected_fingerprint);if(strcmp(expected_fingerprint,r.fingerprint))return 0;
  struct entry *entry=find_entry(r.request.operation_id);
  if(r.type==1){
   if(entry||ledger_count>=MAX_OPERATIONS)return 0;
   entry=&ledger[ledger_count++];memset(entry,0,sizeof *entry);entry->request=r.request;memcpy(entry->fingerprint,r.fingerprint,sizeof entry->fingerprint);entry->state=L_INTERRUPTED;
   if(nt_format_result(entry->reply,sizeof entry->reply,&entry->request,"unknown",NULL,NULL,"interrupted_before_result")<0)return 0;
  }else{
   if(!entry||entry->state==L_FINAL||strcmp(entry->fingerprint,r.fingerprint)||!r.reply[0])return 0;
   memcpy(entry->reply,r.reply,sizeof entry->reply);entry->state=L_FINAL;
  }
 }
 int directory=open(JOURNAL_DIR,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);if(directory<0)return 0;int synced=fsync(directory)==0;close(directory);return synced;
}
static void finalize_mailbox(void){
 if(atomic_load_explicit(&mail_state,memory_order_acquire)!=M_DONE)return;
 struct entry *entry=find_entry(box.request.operation_id);
 if(!entry||entry->state!=L_PENDING){atomic_store(&runtime_status,R_JOURNAL_FAILED);return;}
 const char *outcome=box.result==1?"applied":box.result==0?"rejected":"unknown";
 /* Rejected/unknown operations omit readbacks; only proven application exposes them. */
 if(nt_format_result(entry->reply,sizeof entry->reply,&entry->request,outcome,box.result==1?&box.before:NULL,box.result==1?&box.after:NULL,box.reason)<0){atomic_store(&runtime_status,R_JOURNAL_FAILED);return;}
 if(!journal_append(2,entry)){
  nt_format_result(entry->reply,sizeof entry->reply,&entry->request,"unknown",NULL,NULL,"result_journal_failed");
  entry->state=L_INTERRUPTED;atomic_store(&runtime_status,R_JOURNAL_FAILED);
 }else entry->state=L_FINAL;
 atomic_store_explicit(&mail_state,M_EMPTY,memory_order_release);
}
static int send_all(int fd,const char *p,size_t n){
 while(n){ssize_t sent=send(fd,p,n,MSG_NOSIGNAL);if(sent<0&&errno==EINTR)continue;if(sent<=0)return 0;p+=sent;n-=(size_t)sent;}return 1;
}
static void response(int fd,const char *body){if(body&&body[0]&&send_all(fd,body,strlen(body)))send_all(fd,"\n",1);}
static void status_response(int fd){
 struct nt_snapshot s;nt_runtime_copy_snapshot(&s);
 if(atomic_load(&runtime_status)!=R_READY)unavailable(&s,nt_runtime_state());
 char reply[NT_REPLY_MAX];if(nt_format_status(reply,sizeof reply,session_id,&s)>=0)response(fd,reply);
}
static void reject(int fd,const struct nt_request *r,const char *outcome,const char *reason){char reply[NT_REPLY_MAX];if(nt_format_result(reply,sizeof reply,r,outcome,NULL,NULL,reason)>=0)response(fd,reply);}
static void handle_set(int fd,const struct nt_request *request,uint64_t received_at){
 char fingerprint[65];nt_request_fingerprint(request,fingerprint);struct entry *entry=find_entry(request->operation_id);
 if(entry){if(strcmp(entry->fingerprint,fingerprint))reject(fd,request,"rejected","operation_id_payload_mismatch");else response(fd,entry->reply);return;}
 if(!allow_writes){reject(fd,request,"not_submitted","native_writes_disabled");return;}
 if(atomic_load(&runtime_status)!=R_READY){reject(fd,request,"not_submitted",nt_runtime_state());return;}
 if(ledger_count>=MAX_OPERATIONS){reject(fd,request,"not_submitted","journal_capacity");return;}
 if(atomic_load_explicit(&mail_state,memory_order_acquire)!=M_EMPTY){reject(fd,request,"not_submitted","native_queue_busy");return;}
 struct nt_snapshot current;nt_runtime_copy_snapshot(&current);
 if(!current.available){reject(fd,request,"not_submitted",current.reason[0]?current.reason:"match_unavailable");return;}
 if(strcmp(current.epoch,request->expected_epoch)){reject(fd,request,"rejected","epoch_changed");return;}
 entry=&ledger[ledger_count];memset(entry,0,sizeof *entry);entry->request=*request;memcpy(entry->fingerprint,fingerprint,sizeof entry->fingerprint);entry->state=L_PENDING;
 nt_format_result(entry->reply,sizeof entry->reply,request,"unknown",NULL,NULL,"operation_pending");
 /* An operation enters the game-thread queue only after its intent is durable. */
 if(!journal_append(1,entry)){atomic_store(&runtime_status,R_JOURNAL_FAILED);reject(fd,request,"not_submitted","intent_journal_failed");return;}
 ledger_count++;
 uint64_t now=monotonic_ns(),deadline=received_at+DEADLINE_NS;
 if(!now||now>=deadline){
  nt_format_result(entry->reply,sizeof entry->reply,request,"rejected",NULL,NULL,"request_expired");
  if(journal_append(2,entry))entry->state=L_FINAL;
  else{entry->state=L_INTERRUPTED;nt_format_result(entry->reply,sizeof entry->reply,request,"unknown",NULL,NULL,"result_journal_failed");atomic_store(&runtime_status,R_JOURNAL_FAILED);}
  response(fd,entry->reply);return;
 }
 memset(&box,0,sizeof box);box.request=*request;box.deadline=deadline;
 atomic_store_explicit(&mail_state,M_READY,memory_order_release);
 /* Waiting happens on this socket worker only; the callback never waits. */
 while(atomic_load_explicit(&mail_state,memory_order_acquire)!=M_DONE&&monotonic_ns()<deadline+100000000ULL){struct timespec t={0,1000000};while(nanosleep(&t,&t)&&errno==EINTR){}}
 finalize_mailbox();response(fd,entry->reply);
}
static void handle_client(int fd){
 struct ucred peer;socklen_t peer_len=sizeof peer;
 if(getsockopt(fd,SOL_SOCKET,SO_PEERCRED,&peer,&peer_len)||peer_len!=sizeof peer||peer.uid!=allowed_uid)return;
 struct timeval timeout={0,500000};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof timeout);setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof timeout);
 char body[NT_MAX_BODY+1];size_t used=0;uint64_t received=monotonic_ns();
 while(used<NT_MAX_BODY){
  ssize_t n=recv(fd,body+used,NT_MAX_BODY-used,0);if(n<0&&errno==EINTR)continue;if(n<=0)return;
  size_t prior=used;used+=(size_t)n;char *newline=memchr(body+prior,'\n',(size_t)n);
  if(!newline)continue;
  size_t length=(size_t)(newline-body);for(size_t j=length+1;j<used;j++)if(body[j]!=' '&&body[j]!='\r'&&body[j]!='\n'&&body[j]!='\t')return;
  struct nt_request request;if(!nt_parse_request(body,length,&request))return;
  if(request.is_set)handle_set(fd,&request,received);else status_response(fd);return;
 }
}
static void *runtime_worker(void *unused){
 (void)unused;
 for(;;){
  finalize_mailbox();struct pollfd p={listen_fd,POLLIN,0};int ready=poll(&p,1,100);
  if(ready<0&&errno==EINTR)continue;
  if(ready<=0)continue;
  int fd=accept4(listen_fd,NULL,NULL,SOCK_CLOEXEC);if(fd<0)continue;handle_client(fd);close(fd);
 }
 return NULL;
}
static int open_listener(void){
 struct stat st;
 if(lstat(SOCKET_PATH,&st)==0){
  if(!S_ISSOCK(st.st_mode)||st.st_uid!=getuid())return 0;
  int check=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0);if(check<0)return 0;
  struct sockaddr_un address;memset(&address,0,sizeof address);address.sun_family=AF_UNIX;strcpy(address.sun_path,SOCKET_PATH);
  int result=connect(check,(struct sockaddr *)&address,sizeof address),saved=errno;close(check);
  if(result==0||saved!=ECONNREFUSED||unlink(SOCKET_PATH))return 0;
 }else if(errno!=ENOENT)return 0;
 listen_fd=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC|SOCK_NONBLOCK,0);if(listen_fd<0)return 0;
 struct sockaddr_un address;memset(&address,0,sizeof address);address.sun_family=AF_UNIX;strcpy(address.sun_path,SOCKET_PATH);
 if(bind(listen_fd,(struct sockaddr *)&address,sizeof address)||(socket_gid!=(gid_t)-1&&chown(SOCKET_PATH,(uid_t)-1,socket_gid))||chmod(SOCKET_PATH,0660)||listen(listen_fd,8)){close(listen_fd);listen_fd=-1;return 0;}
 return 1;
}
int nt_runtime_start(const char session[33]){
 snprintf(session_id,sizeof session_id,"%s",session);
 const char *writes=getenv("TICKET_NATIVE_ALLOW_WRITES");allow_writes=writes&&!strcmp(writes,"1");
 const char *peer=getenv("TICKET_NATIVE_PEER_UID");
 if(!peer||!*peer){atomic_store(&runtime_status,R_PEER_REQUIRED);return 0;}
 for(const char *p=peer;*p;p++)if(*p<'0'||*p>'9'){atomic_store(&runtime_status,R_PEER_REQUIRED);return 0;}
 errno=0;char *end;unsigned long parsed=strtoul(peer,&end,10);if(errno||*end||parsed>UINT_MAX){atomic_store(&runtime_status,R_PEER_REQUIRED);return 0;}allowed_uid=(uid_t)parsed;
 const char *group=getenv("TICKET_NATIVE_SOCKET_GID");
 if(group){
  if(!*group){atomic_store(&runtime_status,R_SOCKET_FAILED);return 0;}
  for(const char *p=group;*p;p++)if(*p<'0'||*p>'9'){atomic_store(&runtime_status,R_SOCKET_FAILED);return 0;}
  errno=0;unsigned long gid=strtoul(group,&end,10);
  if(errno||*end||gid==0||gid>UINT_MAX){atomic_store(&runtime_status,R_SOCKET_FAILED);return 0;}
  socket_gid=(gid_t)gid;
 }
 int directory=open(RUNTIME_DIR,O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);struct stat st;
 if(directory<0||fstat(directory,&st)||!S_ISDIR(st.st_mode)||st.st_uid!=getuid()||(st.st_mode&0002)){if(directory>=0)close(directory);atomic_store(&runtime_status,R_DIRECTORY_FAILED);return 0;}close(directory);
 if(!journal_open()){atomic_store(&runtime_status,R_JOURNAL_FAILED);return 0;}
 if(!open_listener()){atomic_store(&runtime_status,R_SOCKET_FAILED);return 0;}
 pthread_t worker;if(pthread_create(&worker,NULL,runtime_worker,NULL)){atomic_store(&runtime_status,R_THREAD_FAILED);return 0;}pthread_detach(worker);atomic_store(&runtime_status,R_READY);return 1;
}
