#include "warmup_control_config.h"
#include <limits.h>
#include <string.h>

struct cursor { const char *at,*end; };
static int literal(struct cursor *c,const char *s){
 size_t n=strlen(s);if((size_t)(c->end-c->at)<n||memcmp(c->at,s,n))return 0;
 c->at+=n;return 1;
}
static int number(struct cursor *c,uint64_t limit,uint64_t *out){
 const char *start=c->at;uint64_t n=0;
 while(c->at<c->end&&*c->at>='0'&&*c->at<='9'){
  unsigned digit=(unsigned)(*c->at-'0');
  if(n>limit/10||(n==limit/10&&digit>limit%10))return 0;
  n=n*10+digit;c->at++;
 }
 if(start==c->at||(c->at-start>1&&*start=='0'))return 0;
 *out=n;return 1;
}
int wc_parse_config(const char *body,size_t bytes,struct wc_config *out){
 if(!body||!out||!bytes||bytes>=512||memchr(body,0,bytes))return 0;
 struct cursor c={body,body+bytes};struct wc_config v={0};uint64_t target,capacity,reserved,settle,enabled;
 if(!literal(&c,"{\"schema\":1,\"revision\":")||!number(&c,UINT64_MAX,&v.revision)||!v.revision||
    !literal(&c,",\"target\":")||!number(&c,WU_MAX_TARGET,&target)||
    !literal(&c,",\"capacity\":")||!number(&c,WU_MAX_CAPACITY,&capacity)||
    !literal(&c,",\"reserved_slots\":")||!number(&c,WU_MAX_CAPACITY,&reserved)||
    !literal(&c,",\"settle_samples\":")||!number(&c,1000,&settle)||
    !literal(&c,",\"enabled\":")||!number(&c,1,&enabled)||!literal(&c,"}\n")||c.at!=c.end)return 0;
 v.values=(struct wu_config){(uint32_t)target,(uint32_t)capacity,(uint32_t)reserved,(uint32_t)settle};
 v.enabled=(int)enabled;
 if(wu_config_validate(&v.values)!=WU_OK)return 0;
 *out=v;return 1;
}
int wc_parse_arm(const char *body,size_t bytes,struct wc_arm *out){
 if(!body||!out||!bytes||bytes>=512||memchr(body,0,bytes))return 0;
 struct cursor c={body,body+bytes};struct wc_arm v={0};uint64_t pid;
 if(!literal(&c,"{\"schema\":1,\"pid\":")||!number(&c,LONG_MAX,&pid)||!pid||
    !literal(&c,",\"start_ticks\":")||!number(&c,UINT64_MAX,&v.start_ticks)||!v.start_ticks||
    !literal(&c,",\"nonce\":\"")||(size_t)(c.end-c.at)<32)return 0;
 for(size_t i=0;i<32;i++){
  char ch=c.at[i];if(!((ch>='0'&&ch<='9')||(ch>='a'&&ch<='f')))return 0;
  v.nonce[i]=ch;
 }
 c.at+=32;
 if(!literal(&c,"\",\"expires_ns\":")||!number(&c,UINT64_MAX,&v.expires_ns)||!v.expires_ns||
    !literal(&c,",\"config_revision\":")||!number(&c,UINT64_MAX,&v.config_revision)||!v.config_revision||
    !literal(&c,"}\n")||c.at!=c.end)return 0;
 v.pid=(long)pid;*out=v;return 1;
}
