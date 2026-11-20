/* Compile-only seam: the actual planner/installer body operates on mock code
 * pages. No game code, mprotect, environment mutation, or engine calls. */
#define WARMUP_REFRESH_CADENCE_FIXTURE 1
#include "refresh_cadence.c"
#include <stdio.h>

static unsigned checks;
#define CHECK(v) do{++checks;if(!(v)){fprintf(stderr,"line %d: %s\n",__LINE__,#v);exit(1);}}while(0)
struct memory_page {uintptr_t base;unsigned char data[4096];int protection;};
static struct memory_page pages[3],before[3];
static const char *setting;
static int startup,read_calls,protect_calls,write_calls,flush_calls,hash_calls;
static int read_fail,protect_fail,protect_fail2,write_fail,hash_fail,drift_on_protect;
static int corrupt_postwrite;
static long test_page_size;
static void *address(uintptr_t at,size_t bytes){
    for(unsigned i=0;i<3;i++){
        if(at>=pages[i].base&&bytes<=sizeof pages[i].data&&
           at-pages[i].base<=sizeof pages[i].data-bytes)
            return pages[i].data+(at-pages[i].base);
    }
    return NULL;
}
static const char *wrc_setting(void){return setting;}
static int wrc_startup_thread(void){return startup;}
static long wrc_page_size(void){return test_page_size;}
static int wrc_read(uintptr_t at,void *out,size_t bytes){
    ++read_calls;
    if(read_calls==read_fail)return 0;
    void *p=address(at,bytes);CHECK(p!=NULL);memcpy(out,p,bytes);return 1;
}
static int wrc_protect(uintptr_t page,size_t bytes,int protection){
    ++protect_calls;CHECK(bytes==4096);
    CHECK(protection==(PROT_READ|PROT_WRITE)||protection==(PROT_READ|PROT_EXEC));
    if(protect_calls==protect_fail||protect_calls==protect_fail2)return 0;
    unsigned i=page==pages[0].base?0:1;CHECK(page==pages[i].base);
    pages[i].protection=protection;
    if(drift_on_protect&&protect_calls==2)((unsigned char *)address(WRC_MANAGER,1))[0]^=1;
    return 1;
}
static int wrc_write(uintptr_t at,const void *source,size_t bytes){
    ++write_calls;
    CHECK(pages[0].protection==(PROT_READ|PROT_WRITE));
    CHECK(pages[1].protection==(PROT_READ|PROT_WRITE));
    CHECK((at==WRC_PRODUCER+4&&bytes==4)||(at==WRC_MANAGER+2&&bytes==8));
    void *p=address(at,bytes);CHECK(p!=NULL);
    if(write_calls==write_fail){memcpy(p,source,bytes/2);return 0;}
    memcpy(p,source,bytes);
    if(corrupt_postwrite&&write_calls==2)((unsigned char *)p)[0]^=1;
    return 1;
}
static void wrc_flush(uintptr_t at,size_t bytes){
    ++flush_calls;
    CHECK((at==WRC_PRODUCER&&bytes==8)||(at==WRC_MANAGER&&bytes==10));
}
/* SHA implementation is the existing common library. Real ELF/function pin
 * checks are independently exercised by verify_refresh_cadence.py; this seam
 * injects preflight/precommit/postimage hash failure into the actual installer. */
static int wrc_function_hashes(int patched){
    ++hash_calls;CHECK(patched==(hash_calls==3));return hash_calls!=hash_fail;
}
static void reset(const char *mode){
    memset(pages,0,sizeof pages);
    pages[0].base=WRC_PRODUCER&~(uintptr_t)4095;
    pages[1].base=WRC_MANAGER&~(uintptr_t)4095;
    pages[2].base=WRC_FLOAT30&~(uintptr_t)4095;
    for(unsigned i=0;i<3;i++){
        memset(pages[i].data,0xcc,sizeof pages[i].data);
        pages[i].protection=i==2?PROT_READ:PROT_READ|PROT_EXEC;
    }
    memcpy(address(WRC_PRODUCER,8),wrc_producer_original,8);
    memcpy(address(WRC_MANAGER,10),wrc_manager_original,10);
    memcpy(address(WRC_FLOAT30,4),wrc_float30,4);
    memcpy(address(WRC_FLOAT2,4),wrc_float2,4);
    const unsigned char apply3[]={0xb8,0x00,0x5e,0xd0,0xb2};
    memcpy(address((uintptr_t)0x8e7a790,sizeof apply3),apply3,sizeof apply3);
    memcpy(before,pages,sizeof pages);
    setting=mode;startup=1;test_page_size=4096;
    read_calls=protect_calls=write_calls=flush_calls=hash_calls=0;
    read_fail=protect_fail=protect_fail2=write_fail=hash_fail=drift_on_protect=corrupt_postwrite=0;
    wrc_attempted=wrc_seconds=0;
}
static void unchanged(void){
    for(unsigned i=0;i<3;i++)CHECK(!memcmp(pages[i].data,before[i].data,sizeof pages[i].data));
}
static void restored(void){
    CHECK(pages[0].protection==(PROT_READ|PROT_EXEC));
    CHECK(pages[1].protection==(PROT_READ|PROT_EXEC));
    CHECK(pages[2].protection==PROT_READ);
}
static void error_contains(const char *error,const char *expected){
    CHECK(error&&strstr(error,expected));CHECK(warmup_refresh_cadence_seconds()==0);
}
int main(void){
    const char *modes[]={NULL,"30","2","10","1","02"," 2","2\n","","0","-2","30.0"};
    for(unsigned i=0;i<sizeof modes/sizeof modes[0];i++){
        reset(modes[i]);const char *error=warmup_refresh_cadence_install(WRC_ELF_SHA);
        if(i<2){CHECK(!error);CHECK(warmup_refresh_cadence_seconds()==30);CHECK(!read_calls&&!protect_calls&&!write_calls);unchanged();}
        else if(i==2){CHECK(!error);CHECK(warmup_refresh_cadence_seconds()==2);}
        else{error_contains(error,"mode_invalid");CHECK(!read_calls&&!protect_calls);unchanged();}
    }
    reset("2");CHECK(!warmup_refresh_cadence_install(WRC_ELF_SHA));
    CHECK(write_calls==2&&protect_calls==4&&flush_calls==2&&hash_calls==3);restored();
    const unsigned char expected_producer[]={0xf3,0x0f,0x10,0x05,0xc9,0xd8,0x47,0xf6};
    const unsigned char expected_manager[]={0x48,0xb8,0x00,0x94,0x35,0x77,0,0,0,0};
    CHECK(!memcmp(address(WRC_PRODUCER,8),expected_producer,8));
    CHECK(!memcmp(address(WRC_MANAGER,10),expected_manager,10));
    for(unsigned i=0;i<3;i++)for(size_t j=0;j<4096;j++){
        uintptr_t at=pages[i].base+j;
        if((at>=WRC_PRODUCER+4&&at<WRC_PRODUCER+8)||(at>=WRC_MANAGER+2&&at<WRC_MANAGER+10))continue;
        CHECK(pages[i].data[j]==before[i].data[j]);
    }
    int writes=write_calls,reads=read_calls;
    CHECK(strstr(warmup_refresh_cadence_install(WRC_ELF_SHA),"already_attempted"));
    CHECK(writes==write_calls&&reads==read_calls);
    for(unsigned which=0;which<4;which++){
        reset("2");uintptr_t at=which==0?WRC_PRODUCER:which==1?WRC_MANAGER:which==2?WRC_FLOAT30:WRC_FLOAT2;
        ((unsigned char *)address(at,1))[0]^=1;memcpy(before,pages,sizeof pages);
        error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),"preimage_mismatch");
        CHECK(!write_calls&&!protect_calls);unchanged();
    }
    for(int n=1;n<=12;n++){
        reset("2");read_fail=n;
        const char *error=warmup_refresh_cadence_install(WRC_ELF_SHA);
        CHECK(error!=NULL);restored();
        if(n<=8){CHECK(!write_calls);unchanged();}
    }
    for(int n=1;n<=3;n++){
        reset("2");hash_fail=n;
        error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),n==1?"preimage":n==2?"precommit":"postimage");
        restored();if(n<3){CHECK(!write_calls);unchanged();}
    }
    reset("2");drift_on_protect=1;
    error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),"precommit_mismatch");CHECK(!write_calls);restored();
    for(int n=1;n<=4;n++){
        reset("2");protect_fail=n;
        error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),n<3?"make_rw":"restore_rx");
        if(n<3){CHECK(!write_calls);unchanged();restored();}
        else CHECK(protect_calls==4); /* second restore is still attempted */
    }
    reset("2");protect_fail=2;protect_fail2=3;
    error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),"restore_rx");CHECK(!write_calls);unchanged();
    for(int n=1;n<=2;n++){
        reset("2");write_fail=n;
        error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),"instruction_write");restored();CHECK(write_calls==n);
    }
    reset("2");corrupt_postwrite=1;
    error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),"postimage_mismatch");restored();
    reset("2");startup=0;error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),"not_single");CHECK(!read_calls&&!write_calls);
    reset("2");error_contains(warmup_refresh_cadence_install(NULL),"elf_not_verified");unchanged();
    reset("2");error_contains(warmup_refresh_cadence_install("bad"),"elf_not_verified");unchanged();
    const long invalid_pages[]={0,-1,1,8,3000,268435456};
    for(unsigned i=0;i<sizeof invalid_pages/sizeof invalid_pages[0];i++){
        reset("2");test_page_size=invalid_pages[i];
        error_contains(warmup_refresh_cadence_install(WRC_ELF_SHA),"page_plan_invalid");CHECK(!read_calls&&!write_calls);
    }
    int32_t d=0;
    CHECK(wrc_rel32(0,(uintptr_t)INT32_MAX,&d)&&d==INT32_MAX);
    CHECK(!wrc_rel32(0,(uintptr_t)INT32_MAX+1,&d));
    CHECK(wrc_rel32((uintptr_t)INT32_MAX+1,0,&d)&&d==INT32_MIN);
    CHECK(!wrc_rel32((uintptr_t)INT32_MAX+2,0,&d));
    CHECK(!wrc_rel32(UINTPTR_MAX,0,&d));CHECK(!wrc_rel32(0,UINTPTR_MAX,&d));
    printf("refresh cadence: %u checks passed\n",checks);return 0;
}
