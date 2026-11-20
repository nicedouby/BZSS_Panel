#define _GNU_SOURCE
#include "native_graph.h"
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

/* All addresses below are data/schema facts for the single SHA pinned by shim. */
#define TABLE 0xd57bcb8UL
#define NAMES 0xd4c7000UL
#define ENGINE 0xd708078UL
#define WORLD 0xd7052c0UL
#define BATCH 2048
#define BAD_OBJECT 0x18010U
#define BAD_SLOT 0x1020000000000000ULL
typedef uint64_t up;
struct obj { up vptr; uint32_t flags; int32_t index; up cls; uint32_t ni,nn; up outer; };
struct slot { uint64_t flags; up object; int32_t serial,other; };
struct table { up chunks,pre; int32_t max,count,maxchunks,nchunks; };
struct identity { up address; int32_t index,serial; };
struct graph { struct identity world,level,gm,gs,t[2]; };
static int memfd=-1, cursor;
static up team_class,gs_class,world_class;
static struct graph active;
static struct nt_snapshot last;
static uint64_t generation;
static uint32_t prev_state[2];
static uint32_t prev_previous[2];
static int32_t prev_elapsed;
static int continuous;
static char session_id[33];

static double realtime_now(void) { struct timespec t; clock_gettime(CLOCK_REALTIME,&t); return t.tv_sec+t.tv_nsec/1e9; }
static int rd(up a,void *p,size_t n) { return a>=0x10000 && a<0x0000800000000000ULL && n<=0x20000 && pread(memfd,p,n,(off_t)a)==(ssize_t)n; }
static up ptr(up a) { up v=0; rd(a,&v,8); return v; }
static int hdr(up a,struct obj *o) { return rd(a,o,sizeof *o) && o->index>=0 && o->cls>=0x10000; }
static int table_read(struct table *t) { return rd(TABLE,t,sizeof *t) && t->count>100 && t->count<=t->max && t->max<(1<<27) && t->nchunks>0 && t->nchunks<=t->maxchunks && t->maxchunks<=8192 && (t->nchunks-1)*65536<t->count && t->count<=t->nchunks*65536; }
static int slot_get(const struct table *tb,int i,struct slot *s) { return i>=0 && i<tb->count && rd(ptr(tb->chunks+8UL*(i/65536))+24UL*(i%65536),s,sizeof *s); }
static int ident(const struct table *tb,up a,struct identity *id) {
    struct obj o; struct slot s;
    if(!hdr(a,&o) || o.flags&BAD_OBJECT || !slot_get(tb,o.index,&s) || s.object!=a || s.serial<=0 || s.flags&BAD_SLOT) return 0;
    id->address=a;id->index=o.index;id->serial=s.serial;return 1;
}
static int stable(const struct table *tb,struct identity i) { struct identity now;return ident(tb,i.address,&now)&&now.index==i.index&&now.serial==i.serial; }
static int fname(uint32_t id,uint32_t number,char *out,size_t cap) {
    if((id>>16)>=8192 || cap<2) return 0;
    up p=ptr(NAMES+8UL*(id>>16))+2UL*(id&65535); uint16_t h;
    if(!rd(p,&h,2))return 0;
    unsigned n=h>>6;
    if(!n || n>=cap || n>1024 || h&1)return 0; /* fixed names/map/state must be ASCII */
    if(!rd(p+2,out,n))return 0;
    for(unsigned j=0;j<n;j++)if((unsigned char)out[j]<32 || (unsigned char)out[j]>126)return 0;
    out[n]=0;
    if(number){int k=snprintf(out+n,cap-n,"_%u",number-1);if(k<0||(size_t)k>=cap-n)return 0;}
    return 1;
}
static int name(up a,char *out,size_t cap) { struct obj o;return hdr(a,&o)&&fname(o.ni,o.nn,out,cap); }
static int is_name(up a,const char *wanted) { char s[128];return name(a,s,sizeof s)&&!strcmp(s,wanted); }
static int derives(up c,up base) { up seen[32];int n=0;while(c && n<32){if(c==base)return 1;for(int j=0;j<n;j++)if(seen[j]==c)return 0;seen[n++]=c;c=ptr(c+0x40);}return 0; }
/* This dedicated-server build must expose one authoritative world context.
 * Both independent engine anchors must agree. Old but valid worlds are refused.
 */
static up current_world(void){
    up e=ptr(ENGINE),a,ctx,w;int32_t n,cap;
    if(!e||ptr(e)!=0x2337bd8UL||!rd(e+0x11a0,&n,4)||!rd(e+0x11a4,&cap,4)||n!=1||cap<n||cap>32)return 0;
    a=ptr(e+0x1198);ctx=ptr(a);w=ptr(ctx+0x2c0);
    return w&&ptr(WORLD)==w?w:0;
}
/* Verify reflected name, field kind, size and offset, including inherited fields. */
static int prop(up c,const char *wanted,const char *type,int size,int offset) {
    up ancestry[32];int count=0;
    while(c && count<32){
        for(int j=0;j<count;j++)if(ancestry[j]==c)return 0;
        ancestry[count++]=c;up p=ptr(c+0x50);
        for(int j=0;j<1024 && p;j++){
            unsigned char raw[0x48];char n[128],kind[128];uint32_t ni,nn;int32_t dim,sz,off;
            if(!rd(p,raw,sizeof raw))return 0;
            memcpy(&ni,raw+0x20,4);memcpy(&nn,raw+0x24,4);
            if(fname(ni,nn,n,sizeof n)&&!strcmp(n,wanted)){
                up fc;memcpy(&fc,raw+8,8);uint32_t fn[2];
                memcpy(&dim,raw+0x2c,4);memcpy(&sz,raw+0x30,4);memcpy(&off,raw+0x44,4);
                return rd(fc,fn,8)&&fname(fn[0],fn[1],kind,sizeof kind)&&!strcmp(kind,type)&&dim==1&&sz==size&&off==offset;
            }
            memcpy(&p,raw+0x18,8);
        }
        c=ptr(c+0x40);
    }
    return 0;
}
static int schema(struct graph *g) {
    struct obj o; if(!hdr(g->gm.address,&o))return 0;up gmcls=o.cls;
    return prop(world_class,"GameState","ObjectProperty",8,0x1e0)
      &&prop(world_class,"PersistentLevel","ObjectProperty",8,0x30)
      &&prop(world_class,"AuthorityGameMode","ObjectProperty",8,0x1d8)
      &&prop(gs_class,"AuthorityGameMode","ObjectProperty",8,0x2c0)
      &&prop(gmcls,"GameState","ObjectProperty",8,0x318)
      &&prop(gs_class,"TeamStates","ArrayProperty",16,0x3b8)
      &&prop(gs_class,"IndexedTeamStates","ArrayProperty",16,0x3c8)
      &&prop(gs_class,"MatchState","NameProperty",8,0x30c)
      &&prop(gs_class,"PreviousMatchState","NameProperty",8,0x314)
      &&prop(gs_class,"ElapsedTime","IntProperty",4,0x31c)
      &&prop(team_class,"Tickets","IntProperty",4,0x2b8)
      &&prop(team_class,"ID","IntProperty",4,0x2e0);
}
static int make_graph(const struct table *tb,up gs,struct graph *g) {
    memset(g,0,sizeof *g);struct obj s,l,w,m;up level,world,gm;
    if(!hdr(gs,&s)||!derives(s.cls,gs_class)||!ident(tb,gs,&g->gs))return 0;
    level=s.outer;if(!hdr(level,&l)||!ident(tb,level,&g->level))return 0;
    world=l.outer;if(!hdr(world,&w)||w.cls!=world_class||!ident(tb,world,&g->world))return 0;
    gm=ptr(gs+0x2c0);if(!hdr(gm,&m)||m.outer!=level||!ident(tb,gm,&g->gm))return 0;
    if(ptr(world+0x1e0)!=gs||ptr(world+0x30)!=level||ptr(world+0x1d8)!=gm||ptr(gm+0x318)!=gs)return 0;
    struct {up p;int32_t n,cap;} a,ix;
    if(!rd(gs+0x3b8,&a,sizeof a)||!rd(gs+0x3c8,&ix,sizeof ix)||a.n<2||a.n>8||a.cap<a.n||a.cap>32||ix.n<3||ix.n>8||ix.cap<ix.n||ix.cap>32)return 0;
    for(int j=0;j<a.n;j++){
        up t=ptr(a.p+8UL*j);struct obj o;int32_t id;
        if(!hdr(t,&o)||o.cls!=team_class||o.outer!=level||!rd(t+0x2e0,&id,4))return 0;
        if(id==0)continue;
        if(id<1||id>2||g->t[id-1].address||ptr(ix.p+8UL*id)!=t||!ident(tb,t,&g->t[id-1]))return 0;
    }
    return g->t[0].address&&g->t[1].address;
}
static int same_graph(const struct graph *a,const struct graph *b){
    const struct identity *x[6]={&a->world,&a->level,&a->gm,&a->gs,&a->t[0],&a->t[1]};
    const struct identity *y[6]={&b->world,&b->level,&b->gm,&b->gs,&b->t[0],&b->t[1]};
    for(int i=0;i<6;i++){
        if(x[i]->address!=y[i]->address||x[i]->index!=y[i]->index||x[i]->serial!=y[i]->serial)return 0;
    }
    return 1;
}
static void unavailable(struct nt_snapshot *s,const char *why) {memset(s,0,sizeof *s);s->observed_at=realtime_now();snprintf(s->reason,sizeof s->reason,"%s",why);continuous=0;}
static int snapshot(const struct table *tb,const struct graph *g,struct nt_snapshot *s) {
    struct graph now;
    if(current_world()!=g->world.address||!stable(tb,g->world)||!stable(tb,g->level)||!stable(tb,g->gm)||!stable(tb,g->gs)||!stable(tb,g->t[0])||!stable(tb,g->t[1])||!make_graph(tb,g->gs.address,&now)||!same_graph(g,&now))return 0;
    uint32_t state[2],previous[2];int32_t elapsed;char current[128],prev[128];
    if(!rd(g->gs.address+0x30c,state,8)||!rd(g->gs.address+0x314,previous,8)||!rd(g->gs.address+0x31c,&elapsed,4)||elapsed<0||!fname(state[0],state[1],current,sizeof current)||!fname(previous[0],previous[1],prev,sizeof prev))return 0;
    /* Exclude shutdown/end/travel. A change invalidates every prepared request. */
    if(strcmp(current,"InProgress")&&strcmp(current,"WaitingToStart"))return 0;
    if(!continuous||memcmp(state,prev_state,8)||memcmp(previous,prev_previous,8)||elapsed<prev_elapsed)generation++;
    continuous=1;memcpy(prev_state,state,8);memcpy(prev_previous,previous,8);prev_elapsed=elapsed;
    memset(s,0,sizeof *s);s->observed_at=realtime_now();
    if(!name(g->world.address,s->map,sizeof s->map)||!rd(g->t[0].address+0x2b8,&s->tickets[0],4)||!rd(g->t[1].address+0x2b8,&s->tickets[1],4)||s->tickets[0]<=0||s->tickets[1]<=0)return 0;
    snprintf(s->epoch,sizeof s->epoch,"%s:%d:%d:%llu",session_id,g->world.serial,g->gs.serial,(unsigned long long)generation);
    s->available=1;return 1;
}
int nt_graph_init(void){if(memfd>=0)return 1;memfd=open("/proc/self/mem",O_RDONLY|O_CLOEXEC);return memfd>=0;}
void nt_graph_tick(const char session[33],struct nt_snapshot *out){
    if(!session_id[0])snprintf(session_id,sizeof session_id,"%s",session);
    struct table tb;
    if(memfd<0||!table_read(&tb)){unavailable(&last,"object_table_unavailable");*out=last;return;}
    if(!(team_class&&gs_class&&world_class)){
        unavailable(&last,"discovering_native_classes");
        int end=cursor+BATCH;if(end>tb.count)end=tb.count;
        for(;cursor<end;cursor++){
            struct slot sl;struct obj o;
            if(!slot_get(&tb,cursor,&sl)||!sl.object||sl.flags&BAD_SLOT||!hdr(sl.object,&o)||o.index!=cursor||o.flags&BAD_OBJECT)continue;
            char n[128];if(!name(sl.object,n,sizeof n))continue;
            if(strcmp(n,"SQTeamState")&&strcmp(n,"SQGameState")&&strcmp(n,"World"))continue;
            if(!is_name(o.cls,"Class"))continue;
            if(!strcmp(n,"SQTeamState")&&is_name(o.outer,"/Script/Squad"))team_class=sl.object;
            if(!strcmp(n,"SQGameState")&&is_name(o.outer,"/Script/Squad"))gs_class=sl.object;
            if(!strcmp(n,"World")&&is_name(o.outer,"/Script/Engine"))world_class=sl.object;
            if(team_class&&gs_class&&world_class)break;
        }
        if(cursor>=tb.count)cursor=0;
        *out=last;return;
    }
    up world=current_world();
    if(!world){unavailable(&last,"current_world_unconfirmed");*out=last;return;}
    if(active.gs.address&&snapshot(&tb,&active,&last)){*out=last;return;}
    memset(&active,0,sizeof active);unavailable(&last,"match_not_writable");
    struct graph found;
    if(make_graph(&tb,ptr(world+0x1e0),&found)&&found.world.address==world&&schema(&found)){
        active=found;
        if(!snapshot(&tb,&active,&last))unavailable(&last,"match_not_writable");
    }
    *out=last;
}
int nt_graph_apply(const char *epoch,int t1,int t2,struct nt_snapshot *before,struct nt_snapshot *after,char why[65]){
    struct table tb;struct nt_snapshot now;
    if((t1!=-1&&(t1<1||t1>9999))||(t2!=-1&&(t2<1||t2>9999))||(t1==-1&&t2==-1)){strcpy(why,"invalid_tickets");return 0;}
    if(!active.gs.address||!table_read(&tb)||!snapshot(&tb,&active,&now)){strcpy(why,"match_not_writable");return 0;}
    if(!epoch||strcmp(epoch,now.epoch)){strcpy(why,"epoch_changed");return 0;}
    *before=now;
    /* Same aligned int32 store as decoded SetTickets; callback owns GameThread. */
    if(t1!=-1)*(volatile int32_t *)(uintptr_t)(active.t[0].address+0x2b8)=t1;
    if(t2!=-1)*(volatile int32_t *)(uintptr_t)(active.t[1].address+0x2b8)=t2;
    if(!snapshot(&tb,&active,&now)||strcmp(now.epoch,epoch)||(t1!=-1&&now.tickets[0]!=t1)||(t2!=-1&&now.tickets[1]!=t2)){strcpy(why,"readback_unknown");return -1;}
    *after=now;last=now;why[0]=0;return 1;
}
