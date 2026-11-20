#define _POSIX_C_SOURCE 200809L
#include "refresh_cadence.h"
#include "../common/sha256.h"
#include <dirent.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#if !defined(WARMUP_REFRESH_CADENCE_FIXTURE) && \
    (!defined(__linux__) || !defined(__x86_64__))
#error "Refresh cadence requires the pinned Linux x86_64 executable"
#endif
#if defined(__BYTE_ORDER__) && __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error "Refresh cadence requires little-endian instruction encoding"
#endif
_Static_assert(sizeof(uintptr_t)==8,"64-bit addresses required");

#define WRC_ELF_SHA "86770cae6d030e37ab9e435e753e7e76ff59e6853190671627af771e02c148d5"
#define WRC_PRODUCER ((uintptr_t)0xa4fb193)
#define WRC_MANAGER ((uintptr_t)0x8e7a9a1)
#define WRC_FLOAT30 ((uintptr_t)0x9789a4)
#define WRC_FLOAT2 ((uintptr_t)0x978a64)
static const unsigned char wrc_producer_original[8]={0xf3,0x0f,0x10,0x05,0x09,0xd8,0x47,0xf6};
static const unsigned char wrc_manager_original[10]={0x48,0xb8,0x00,0xac,0x23,0xfc,0x06,0x00,0x00,0x00};
static const unsigned char wrc_float30[4]={0x00,0x00,0xf0,0x41};
static const unsigned char wrc_float2[4]={0x00,0x00,0x00,0x40};

struct wrc_plan {
    uintptr_t pages[2];
    size_t page_size;
    unsigned char producer[8],manager[10];
};
static int wrc_attempted,wrc_seconds;

/* The fixture replaces only OS/memory access, never mode/planning/apply logic.
 * These static seams cannot be selected by a production caller or environment. */
#ifdef WARMUP_REFRESH_CADENCE_FIXTURE
static const char *wrc_setting(void);
static int wrc_startup_thread(void);
static long wrc_page_size(void);
static int wrc_read(uintptr_t at,void *out,size_t bytes);
static int wrc_protect(uintptr_t page,size_t bytes,int protection);
static int wrc_write(uintptr_t at,const void *source,size_t bytes);
static void wrc_flush(uintptr_t at,size_t bytes);
static int wrc_function_hashes(int patched);
#else
static const char *wrc_setting(void){return getenv("WARMUP_REFRESH_CADENCE");}
static int wrc_startup_thread(void){
    DIR *d=opendir("/proc/self/task");
    if(!d)return 0;
    unsigned count=0;struct dirent *entry;
    while((entry=readdir(d)))if(entry->d_name[0]!='.')++count;
    int closed=closedir(d);
    return !closed&&count==1;
}
static long wrc_page_size(void){return sysconf(_SC_PAGESIZE);}
static int wrc_read(uintptr_t at,void *out,size_t bytes){
    memcpy(out,(const void *)at,bytes);return 1;
}
static int wrc_protect(uintptr_t page,size_t bytes,int protection){
    return mprotect((void *)page,bytes,protection)==0;
}
static int wrc_write(uintptr_t at,const void *source,size_t bytes){
    memcpy((void *)at,source,bytes);return 1;
}
static void wrc_flush(uintptr_t at,size_t bytes){
    __builtin___clear_cache((char *)at,(char *)(at+bytes));
}
static int wrc_hash_function(uintptr_t at,size_t bytes,const char *expected,
                             uintptr_t edit,const unsigned char *original,size_t edit_bytes,
                             int patched){
    nt_sha256 state;unsigned char block[256],digest[32];char hex[65];
    static const char digits[]="0123456789abcdef";
    nt_sha256_init(&state);
    for(size_t offset=0;offset<bytes;){
        size_t count=bytes-offset;
        if(count>sizeof block)count=sizeof block;
        if(!wrc_read(at+offset,block,count))return 0;
        /* Hash the postimage as the original by normalizing only the already
         * separately checked edit bytes. Other function changes still fail. */
        if(patched){
            for(size_t j=0;j<edit_bytes;j++){
                if(edit+j>=at+offset&&edit+j-(at+offset)<count)
                    block[edit+j-(at+offset)]=original[j];
            }
        }
        nt_sha256_update(&state,block,count);offset+=count;
    }
    nt_sha256_final(&state,digest);
    for(unsigned i=0;i<32;i++){hex[2*i]=digits[digest[i]>>4];hex[2*i+1]=digits[digest[i]&15];}
    hex[64]=0;return !strcmp(hex,expected);
}
static int wrc_function_hashes(int patched){
    return wrc_hash_function((uintptr_t)0xa4fb050,1119,
        "09a5b27510b9e22db1b9af5924ba68dca5456cc814339387ae570b03a59aa492",
        WRC_PRODUCER+4,wrc_producer_original+4,4,patched)&&
        wrc_hash_function((uintptr_t)0x8e7a380,2021,
        "34dd461f9ad337725d54e9c4c98df5f81c4035a926fadb2fa2bae667c1d65505",
        WRC_MANAGER+2,wrc_manager_original+2,8,patched);
}
#endif

static int wrc_mode(const char *value){
    if(!value||!strcmp(value,"30"))return 30;
    return !strcmp(value,"2")?2:0;
}
static int wrc_rel32(uintptr_t next,uintptr_t target,int32_t *out){
    if(!out)return 0;
    if(target>=next){
        uintptr_t n=target-next;
        if(n>(uintptr_t)INT32_MAX)return 0;
        *out=(int32_t)n;
    }else{
        uintptr_t n=next-target;
        if(n>(uintptr_t)INT32_MAX+1)return 0;
        *out=(int32_t)(-(int64_t)n);
    }
    return 1;
}
static int wrc_make_plan(long page_size,struct wrc_plan *p){
    if(!p||page_size<=0)return 0;
    uintptr_t size=(uintptr_t)page_size;
    if((size&(size-1))||size<10)return 0;
    memset(p,0,sizeof *p);p->page_size=(size_t)size;
    p->pages[0]=WRC_PRODUCER&~(size-1);
    p->pages[1]=WRC_MANAGER&~(size-1);
    if(p->pages[0]==p->pages[1]||
       WRC_PRODUCER-p->pages[0]>size-sizeof p->producer||
       WRC_MANAGER-p->pages[1]>size-sizeof p->manager)return 0;
    int32_t displacement;
    if(!wrc_rel32(WRC_PRODUCER+sizeof p->producer,WRC_FLOAT2,&displacement))return 0;
    memcpy(p->producer,wrc_producer_original,sizeof p->producer);
    memcpy(p->producer+4,&displacement,sizeof displacement);
    memcpy(p->manager,wrc_manager_original,sizeof p->manager);
    const uint64_t duration=UINT64_C(2000000000);
    memcpy(p->manager+2,&duration,sizeof duration);
    return 1;
}
static int wrc_matches(const struct wrc_plan *p,int patched){
    unsigned char producer[8],manager[10],f30[4],f2[4];
    return wrc_read(WRC_PRODUCER,producer,sizeof producer)&&
        wrc_read(WRC_MANAGER,manager,sizeof manager)&&
        wrc_read(WRC_FLOAT30,f30,sizeof f30)&&
        wrc_read(WRC_FLOAT2,f2,sizeof f2)&&
        !memcmp(producer,patched?p->producer:wrc_producer_original,sizeof producer)&&
        !memcmp(manager,patched?p->manager:wrc_manager_original,sizeof manager)&&
        !memcmp(f30,wrc_float30,sizeof f30)&&!memcmp(f2,wrc_float2,sizeof f2);
}
/* Always try every page which was made writable, even after one restore fails. */
static int wrc_restore(const struct wrc_plan *p,unsigned writable){
    int okay=1;
    for(unsigned i=0;i<writable;i++){
        if(!wrc_protect(p->pages[i],p->page_size,PROT_READ|PROT_EXEC))okay=0;
    }
    return okay;
}
const char *warmup_refresh_cadence_install(const char *verified_elf_sha){
    if(wrc_attempted)return "refresh_cadence_already_attempted_fatal";
    wrc_attempted=1;
    int mode=wrc_mode(wrc_setting());
    if(!mode)return "refresh_cadence_mode_invalid_fatal";
    if(mode==30){wrc_seconds=30;return NULL;}
    if(!verified_elf_sha||strcmp(verified_elf_sha,WRC_ELF_SHA))
        return "refresh_cadence_elf_not_verified_fatal";
    if(!wrc_startup_thread())return "refresh_cadence_not_single_startup_thread_fatal";
    struct wrc_plan plan;
    if(!wrc_make_plan(wrc_page_size(),&plan))return "refresh_cadence_page_plan_invalid_fatal";
    if(!wrc_matches(&plan,0)||!wrc_function_hashes(0))return "refresh_cadence_preimage_mismatch_fatal";
    unsigned writable=0;
    for(;writable<2;writable++){
        if(!wrc_protect(plan.pages[writable],plan.page_size,PROT_READ|PROT_WRITE)){
            if(!wrc_restore(&plan,writable))return "refresh_cadence_restore_rx_failed_fatal";
            return "refresh_cadence_make_rw_failed_fatal";
        }
    }
    /* Both pages are writable before the first instruction edit. A second
     * comparison rejects drift without any instruction write. */
    if(!wrc_matches(&plan,0)||!wrc_function_hashes(0)){
        if(!wrc_restore(&plan,writable))return "refresh_cadence_restore_rx_failed_fatal";
        return "refresh_cadence_precommit_mismatch_fatal";
    }
    int wrote=wrc_write(WRC_PRODUCER+4,plan.producer+4,4);
    if(wrote)wrote=wrc_write(WRC_MANAGER+2,plan.manager+2,8);
    wrc_flush(WRC_PRODUCER,sizeof plan.producer);
    wrc_flush(WRC_MANAGER,sizeof plan.manager);
    if(!wrc_restore(&plan,writable))return "refresh_cadence_restore_rx_failed_fatal";
    if(!wrote)return "refresh_cadence_instruction_write_failed_fatal";
    if(!wrc_matches(&plan,1)||!wrc_function_hashes(1))return "refresh_cadence_postimage_mismatch_fatal";
    wrc_seconds=2;
    return NULL;
}
int warmup_refresh_cadence_seconds(void){return wrc_seconds;}
