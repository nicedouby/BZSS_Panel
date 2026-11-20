#define _GNU_SOURCE
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

/* Only credential/chown API results are injected; the mailbox/journal code is real. */
static int fake_credential_error, credential_calls, receive_calls, chown_calls, fake_chown_error;
static uid_t fake_peer_uid;
static gid_t requested_gid;
static int test_getsockopt(int,int,int,void *,socklen_t *);
static int test_chown(const char *,uid_t,gid_t);
static ssize_t test_recv(int,void *,size_t,int);
#define getsockopt test_getsockopt
#define chown test_chown
#define recv test_recv
#include "runtime_under_test.c"
#undef getsockopt
#undef chown
#undef recv

static int graph_calls;
static const char test_epoch[]="0123456789abcdef0123456789abcdef:10:20:1";
static struct nt_snapshot test_snapshot(void){
 struct nt_snapshot s;memset(&s,0,sizeof s);s.available=1;strcpy(s.epoch,test_epoch);strcpy(s.map,"UnitTestOnly");s.tickets[0]=250;s.tickets[1]=250;s.observed_at=realtime_now();return s;
}
int nt_graph_apply(const char *epoch,int team1,int team2,struct nt_snapshot *before,struct nt_snapshot *after,char reason[65]){
 graph_calls++;
 if(strcmp(epoch,test_epoch)){strcpy(reason,"epoch_changed");return 0;}
 *before=test_snapshot();*after=*before;
 if(team1!=-1)after->tickets[0]=team1;
 if(team2!=-1)after->tickets[1]=team2;
 reason[0]=0;return 1;
}
static int test_getsockopt(int fd,int level,int name,void *data,socklen_t *length){
 (void)fd;(void)level;(void)name;credential_calls++;
 if(fake_credential_error){errno=EPERM;return -1;}
 struct ucred peer={0};peer.uid=fake_peer_uid;assert(*length>=sizeof peer);memcpy(data,&peer,sizeof peer);*length=sizeof peer;return 0;
}
static int test_chown(const char *path,uid_t user,gid_t group){
 (void)path;assert(user==(uid_t)-1);chown_calls++;requested_gid=group;
 if(fake_chown_error){errno=EPERM;return -1;}return 0;
}
static ssize_t test_recv(int fd,void *p,size_t size,int flags){receive_calls++;return recv(fd,p,size,flags);}
#ifdef __APPLE__
int accept4(int fd,struct sockaddr *address,unsigned int *length,int flags){(void)flags;return accept(fd,address,length);}
#endif
static void pair(int fds[2]){assert(socketpair(AF_UNIX,SOCK_STREAM,0,fds)==0);}
static void read_reply(int fd,char reply[NT_REPLY_MAX]){
 ssize_t count=recv(fd,reply,NT_REPLY_MAX-1,0);assert(count>0);reply[count]=0;
}
static struct nt_request request(char fill,int t1,int t2){
 struct nt_request r;memset(&r,0,sizeof r);r.is_set=1;memset(r.operation_id,fill,32);strcpy(r.expected_epoch,test_epoch);r.team1=t1;r.team2=t2;return r;
}
static void prepare_mail(const struct nt_request *r,uint64_t deadline){
 assert(atomic_load(&mail_state)==M_EMPTY);memset(&box,0,sizeof box);box.request=*r;box.deadline=deadline;atomic_store_explicit(&mail_state,M_READY,memory_order_release);
}
static void refresh(void){struct nt_snapshot s=test_snapshot();pthread_mutex_lock(&snapshot_lock);published=s;pthread_mutex_unlock(&snapshot_lock);}
struct submit_args {int fd;struct nt_request request;};
static void *submit(void *p){struct submit_args *a=p;handle_set(a->fd,&a->request,monotonic_ns());return NULL;}
static void restart_journal(void){assert(journal_fd>=0);close(journal_fd);journal_fd=-1;memset(ledger,0,sizeof ledger);ledger_count=0;assert(journal_open());}

int main(void){
 struct nt_snapshot s=test_snapshot();struct nt_request r=request('a',333,-1);
 allow_writes=1;
 /* Held publication lock cannot block the game thread. */
 pthread_mutex_lock(&snapshot_lock);uint64_t begin=monotonic_ns();nt_runtime_on_tick(&s);assert(monotonic_ns()-begin<100000000ULL);pthread_mutex_unlock(&snapshot_lock);
 assert(graph_calls==0);
 /* Late callbacks reject expired mail before reaching the graph writer. */
 prepare_mail(&r,monotonic_ns()-1);nt_runtime_on_tick(&s);
 assert(atomic_load_explicit(&mail_state,memory_order_acquire)==M_DONE);assert(box.result==0&&!strcmp(box.reason,"request_expired"));assert(graph_calls==0);atomic_store(&mail_state,M_EMPTY);
 /* A valid mailbox invokes apply exactly once, including across future Ticks. */
 prepare_mail(&r,monotonic_ns()+DEADLINE_NS);nt_runtime_on_tick(&s);assert(box.result==1&&graph_calls==1);
 for(int i=0;i<10000;i++)nt_runtime_on_tick(&s);
 assert(graph_calls==1);atomic_store(&mail_state,M_EMPTY);
 allow_writes=0;prepare_mail(&r,monotonic_ns()+DEADLINE_NS);nt_runtime_on_tick(&s);assert(box.result==0&&!strcmp(box.reason,"native_writes_disabled")&&graph_calls==1);atomic_store(&mail_state,M_EMPTY);
 /* Missing/malformed trusted configuration denies startup before any worker. */
 unsetenv("TICKET_NATIVE_PEER_UID");assert(!nt_runtime_start("0123456789abcdef0123456789abcdef"));assert(atomic_load(&runtime_status)==R_PEER_REQUIRED);
 const char *bad_uids[]={"","-1","+1","2x","42949672960"};
 for(size_t i=0;i<sizeof bad_uids/sizeof bad_uids[0];i++){setenv("TICKET_NATIVE_PEER_UID",bad_uids[i],1);assert(!nt_runtime_start("0123456789abcdef0123456789abcdef"));assert(atomic_load(&runtime_status)==R_PEER_REQUIRED);}
 setenv("TICKET_NATIVE_PEER_UID","1000",1);
 const char *bad_gids[]={"","0","-1","+1","4x","42949672960"};
 for(size_t i=0;i<sizeof bad_gids/sizeof bad_gids[0];i++){setenv("TICKET_NATIVE_SOCKET_GID",bad_gids[i],1);assert(!nt_runtime_start("0123456789abcdef0123456789abcdef"));assert(atomic_load(&runtime_status)==R_SOCKET_FAILED);}
 unsetenv("TICKET_NATIVE_SOCKET_GID");
 /* Credential errors and wrong UIDs are rejected before reading any request. */
 allowed_uid=1000;fake_peer_uid=1001;handle_client(-1);assert(credential_calls==1&&receive_calls==0);
 fake_peer_uid=1000;fake_credential_error=1;handle_client(-1);assert(credential_calls==2&&receive_calls==0);fake_credential_error=0;
 /* An explicit socket GID is applied before listen; failure closes the listener. */
 socket_gid=42;fake_chown_error=1;assert(!open_listener());assert(listen_fd==-1&&chown_calls==1&&requested_gid==42);
 fake_chown_error=0;assert(open_listener());assert(chown_calls==2&&requested_gid==42);struct stat socket_stat;assert(!lstat(SOCKET_PATH,&socket_stat)&&(socket_stat.st_mode&0777)==0660);close(listen_fd);listen_fd=-1;assert(unlink(SOCKET_PATH)==0);
 /* Real durable intents plus a worker timeout never become late writes. */
 assert(journal_open());atomic_store(&runtime_status,R_READY);allow_writes=1;refresh();
 int fds[2];char reply[NT_REPLY_MAX];pair(fds);handle_set(fds[0],&r,monotonic_ns());read_reply(fds[1],reply);close(fds[0]);close(fds[1]);
 assert(strstr(reply,"\"outcome\":\"unknown\"")&&strstr(reply,"operation_pending"));assert(atomic_load(&mail_state)==M_READY);
 int calls_before=graph_calls;nt_runtime_on_tick(&s);assert(box.result==0&&!strcmp(box.reason,"request_expired")&&graph_calls==calls_before);finalize_mailbox();assert(atomic_load(&mail_state)==M_EMPTY);
 struct entry *timed_out=find_entry(r.operation_id);assert(timed_out&&timed_out->state==L_FINAL&&strstr(timed_out->reply,"\"outcome\":\"rejected\""));
 /* Normal worker submission, durable result, and duplicate receipt only. */
 r=request('b',777,888);refresh();pair(fds);struct submit_args args={fds[0],r};pthread_t worker;assert(pthread_create(&worker,NULL,submit,&args)==0);
 uint64_t limit=monotonic_ns()+3000000000ULL;
 while(atomic_load_explicit(&mail_state,memory_order_acquire)!=M_READY&&monotonic_ns()<limit){struct timespec delay={0,1000000};nanosleep(&delay,NULL);}
 assert(atomic_load_explicit(&mail_state,memory_order_acquire)==M_READY);nt_runtime_on_tick(&s);pthread_join(worker,NULL);read_reply(fds[1],reply);close(fds[0]);close(fds[1]);
 assert(strstr(reply,"\"outcome\":\"applied\""));assert(graph_calls==calls_before+1&&atomic_load(&mail_state)==M_EMPTY);
 struct stat old_stat,new_stat;assert(fstat(journal_fd,&old_stat)==0);pair(fds);handle_set(fds[0],&r,monotonic_ns());read_reply(fds[1],reply);close(fds[0]);close(fds[1]);assert(strstr(reply,"\"outcome\":\"applied\""));assert(fstat(journal_fd,&new_stat)==0&&new_stat.st_size==old_stat.st_size&&graph_calls==calls_before+1);
 r.team1=778;pair(fds);handle_set(fds[0],&r,monotonic_ns());read_reply(fds[1],reply);close(fds[0]);close(fds[1]);assert(strstr(reply,"operation_id_payload_mismatch")&&graph_calls==calls_before+1);
 for(int i=0;i<10000;i++)nt_runtime_on_tick(&s);
 assert(graph_calls==calls_before+1);
 /* Crash recovery keeps completed receipts and marks pending intents unknown. */
 r=request('c',9999,9999);struct entry *pending=&ledger[ledger_count++];memset(pending,0,sizeof *pending);pending->request=r;nt_request_fingerprint(&r,pending->fingerprint);pending->state=L_PENDING;assert(journal_append(1,pending));
 restart_journal();pending=find_entry(r.operation_id);assert(pending&&pending->state==L_INTERRUPTED&&strstr(pending->reply,"interrupted_before_result"));assert(graph_calls==calls_before+1);
 struct nt_request completed=request('b',777,888);struct entry *finished=find_entry(completed.operation_id);assert(finished&&finished->state==L_FINAL&&strstr(finished->reply,"\"outcome\":\"applied\""));
 pair(fds);handle_set(fds[0],&r,monotonic_ns());read_reply(fds[1],reply);close(fds[0]);close(fds[1]);assert(strstr(reply,"\"outcome\":\"unknown\"")&&graph_calls==calls_before+1&&atomic_load(&mail_state)==M_EMPTY);
 /* Partial trailing records are rejected without truncation or replay. */
 assert(write(journal_fd,"x",1)==1&&fsync(journal_fd)==0);assert(fstat(journal_fd,&old_stat)==0);close(journal_fd);journal_fd=-1;memset(ledger,0,sizeof ledger);ledger_count=0;assert(!journal_open());assert(fstat(journal_fd,&new_stat)==0&&old_stat.st_size==new_stat.st_size&&graph_calls==calls_before+1);close(journal_fd);
 puts("{\"runtime_invariants\":\"passed\",\"late_tick_writes\":0,\"duplicate_replays\":0,\"recovered_pending_replays\":0,\"future_tick_count\":20000}");
 return 0;
}
