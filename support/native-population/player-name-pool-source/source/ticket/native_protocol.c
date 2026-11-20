#include "native_protocol.h"
#include "sha256.h"
#include <ctype.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

struct parser { const unsigned char *p,*end; };
static void spaces(struct parser *p){while(p->p<p->end&&(*p->p==' '||*p->p=='\r'||*p->p=='\n'||*p->p=='\t'))p->p++;}
static int token(struct parser *p,int c){spaces(p);if(p->p==p->end||*p->p!=c)return 0;p->p++;return 1;}
static int digit(int c){if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;if(c>='A'&&c<='F')return c-'A'+10;return -1;}
static int string(struct parser *p,char *out,size_t cap){
 if(!token(p,'"'))return 0;
 size_t n=0;
 while(p->p<p->end){unsigned c=*p->p++;if(c=='"'){out[n]=0;return 1;}if(c=='\\'){
  if(p->p==p->end)return 0;
  c=*p->p++;
  if(c=='u'){c=0;for(int j=0;j<4;j++){if(p->p==p->end)return 0;int d=digit(*p->p++);if(d<0)return 0;c=c*16+(unsigned)d;}}
  else if(c!='"'&&c!='\\'&&c!='/')return 0;
 }
 /* This fixed protocol uses ASCII identifiers, never arbitrary user text. */
 if(c<32||c>126||n+1>=cap)return 0;
 out[n++]=(char)c;
 }return 0;
}
static int number(struct parser *p,int *out){spaces(p);if(p->p==p->end||*p->p<'1'||*p->p>'9')return 0;int n=0;while(p->p<p->end&&*p->p>='0'&&*p->p<='9'){n=n*10+(*p->p++-'0');if(n>9999)return 0;}*out=n;return 1;}
int nt_hex_string(const char *s,size_t n){if(strlen(s)!=n)return 0;for(size_t i=0;i<n;i++)if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return 0;return 1;}
int nt_parse_request(const char *body,size_t size,struct nt_request *out){
 if(!body||!size||size>NT_MAX_BODY)return 0;
 struct parser p={(const unsigned char *)body,(const unsigned char *)body+size};struct nt_request req={0};req.team1=-1;req.team2=-1;unsigned mask=0;char op[16]={0};
 if(!token(&p,'{'))return 0;
 for(;;){char key[33];unsigned bit;if(!string(&p,key,sizeof key)||!token(&p,':'))return 0;
  if(!strcmp(key,"op"))bit=1;else if(!strcmp(key,"operation_id"))bit=2;else if(!strcmp(key,"expected_epoch"))bit=4;else if(!strcmp(key,"team1"))bit=8;else if(!strcmp(key,"team2"))bit=16;else return 0;
  if(mask&bit)return 0;
  mask|=bit;
  if(bit==1){if(!string(&p,op,sizeof op))return 0;}else if(bit==2){if(!string(&p,req.operation_id,sizeof req.operation_id))return 0;}else if(bit==4){if(!string(&p,req.expected_epoch,sizeof req.expected_epoch))return 0;}else if(!number(&p,bit==8?&req.team1:&req.team2))return 0;
  spaces(&p);if(p.p<p.end&&*p.p=='}'){p.p++;break;}if(!token(&p,','))return 0;
 }
 spaces(&p);if(p.p!=p.end)return 0;
 if(!strcmp(op,"status")&&mask==1){*out=req;return 1;}
 if(strcmp(op,"set")||(mask&7)!=7||!(mask&24)||!nt_hex_string(req.operation_id,32)||!req.expected_epoch[0])return 0;
 for(const unsigned char *s=(const unsigned char *)req.expected_epoch;*s;s++)if(*s<=32||*s>=127)return 0;
 req.is_set=1;*out=req;return 1;
}
void nt_request_fingerprint(const struct nt_request *r,char out[65]){
 nt_sha256 hash;unsigned char d[32],integers[8];static const char hex[]="0123456789abcdef";nt_sha256_init(&hash);nt_sha256_update(&hash,"native_tickets_v1\0",18);nt_sha256_update(&hash,r->expected_epoch,strlen(r->expected_epoch)+1);
 uint32_t a=(uint32_t)r->team1,b=(uint32_t)r->team2;for(unsigned i=0;i<4;i++){integers[i]=(unsigned char)(a>>(i*8));integers[4+i]=(unsigned char)(b>>(i*8));}nt_sha256_update(&hash,integers,sizeof integers);nt_sha256_final(&hash,d);for(unsigned i=0;i<32;i++){out[2*i]=hex[d[i]>>4];out[2*i+1]=hex[d[i]&15];}out[64]=0;
}
struct writer { char *p;size_t len,cap;int failed; };
static void add(struct writer *w,const char *format,...){if(w->failed)return;va_list args;va_start(args,format);int n=vsnprintf(w->p+w->len,w->cap-w->len,format,args);va_end(args);if(n<0||(size_t)n>=w->cap-w->len){w->failed=1;return;}w->len+=(size_t)n;}
static void quote(struct writer *w,const char *s){add(w,"\"");for(const unsigned char *p=(const unsigned char *)s;*p;p++){if(*p=='"'||*p=='\\')add(w,"\\%c",*p);else if(*p<32||*p>=127)add(w,"\\u%04x",*p);else add(w,"%c",*p);}add(w,"\"");}
static int reason_ok(const char *s){size_t n=strlen(s);if(!n||n>64||s[0]<'a'||s[0]>'z')return 0;for(size_t i=0;i<n;i++)if(!((s[i]>='a'&&s[i]<='z')||(s[i]>='0'&&s[i]<='9')||s[i]=='_'))return 0;return 1;}
static void reason(struct writer *w,const char *s){if(s&&*s)quote(w,reason_ok(s)?s:"invalid_native_reason");else add(w,"null");}
static void teams(struct writer *w,const struct nt_snapshot *s){if(!s||!s->available){add(w,"[]");return;}add(w,"[{\"id\":1,\"tickets\":%d},{\"id\":2,\"tickets\":%d}]",s->tickets[0],s->tickets[1]);}
int nt_format_status(char *out,size_t cap,const char session[33],const struct nt_snapshot *s){
 struct writer w={out,0,cap,0};if(!cap)return -1;out[0]=0;
 add(&w,"{\"schema\":1,\"build_sha256\":\"%s\",\"session_id\":\"%s\",\"observed_at\":%.6f,\"available\":%s,\"epoch\":",NT_BUILD_SHA,session,s->observed_at,s->available?"true":"false");
 if(s->available)quote(&w,s->epoch);else add(&w,"null");add(&w,",\"map\":");if(s->available)quote(&w,s->map);else add(&w,"null");add(&w,",\"teams\":");teams(&w,s);add(&w,",\"reason\":");reason(&w,s->reason);add(&w,"}");return w.failed?-1:(int)w.len;
}
int nt_format_result(char *out,size_t cap,const struct nt_request *r,const char *outcome,const struct nt_snapshot *before,const struct nt_snapshot *after,const char *why){
 struct writer w={out,0,cap,0};if(!cap)return -1;out[0]=0;
 add(&w,"{\"operation_id\":\"%s\",\"outcome\":\"%s\",\"epoch\":",r->operation_id,outcome);quote(&w,r->expected_epoch);add(&w,",\"before\":");teams(&w,before);add(&w,",\"after\":");teams(&w,after);add(&w,",\"reason\":");reason(&w,why);add(&w,"}");return w.failed?-1:(int)w.len;
}
