#define _GNU_SOURCE
#include "warmup_admission.h"
#include "selector_preimage.generated.h"
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <errno.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/sysmacros.h>

_Static_assert(sizeof(void *)==8,"Linux x86-64 required");
_Static_assert(sizeof warmup_selector_preimage==WARMUP_ADMISSION_SELECTOR_SIZE,"full selector preimage");
_Static_assert(WARMUP_ADMISSION_PATCH_ADDRESS-WARMUP_ADMISSION_SELECTOR_ADDRESS==WARMUP_ADMISSION_PATCH_OFFSET,"exact immediate offset");
static _Atomic int install_attempted;
static const unsigned char replacement[4]={0,0,0,0x80};
static void fail_text(char *error,size_t capacity,const char *text){if(error&&capacity)snprintf(error,capacity,"%s",text);}
size_t warmup_admission_selector_size(void){return sizeof warmup_selector_preimage;}
int warmup_admission_prepare(const unsigned char *original,size_t size,unsigned char *candidate,size_t capacity){
 if(!original||!candidate||size!=sizeof warmup_selector_preimage||capacity<size||memcmp(original,warmup_selector_preimage,size))return 0;
 /* Exact in-place use is allowed; memmove also makes overlapping test buffers defined. */
 memmove(candidate,original,size);memcpy(candidate+WARMUP_ADMISSION_PATCH_OFFSET,replacement,sizeof replacement);return 1;
}
int warmup_admission_is_candidate(const unsigned char *code,size_t size){
 const size_t at=WARMUP_ADMISSION_PATCH_OFFSET;
 return code&&size==sizeof warmup_selector_preimage&&!memcmp(code,warmup_selector_preimage,at)&&!memcmp(code+at,replacement,sizeof replacement)&&!memcmp(code+at+sizeof replacement,warmup_selector_preimage+at+sizeof replacement,size-at-sizeof replacement);
}
static int one_main_thread(void){
 if((pid_t)syscall(SYS_gettid)!=getpid())return 0;
 DIR *directory=opendir("/proc/self/task");if(!directory)return 0;
 int count=0;struct dirent *entry;
 while((entry=readdir(directory))!=NULL)if(entry->d_name[0]>='0'&&entry->d_name[0]<='9')count++;
 int okay=closedir(directory)==0;return okay&&count==1;
}
static int executable_private_rx(uintptr_t start,uintptr_t end,uintptr_t page_start,uintptr_t page_end){
 struct stat executable;if(stat("/proc/self/exe",&executable))return 0;
 FILE *maps=fopen("/proc/self/maps","r");if(!maps)return 0;
 /* Kernel may keep restored file-private COW pages in separate VMAs. Require
  * complete contiguous RX coverage, not a potentially false one-VMA assumption. */
 uintptr_t cursor=start<page_start?start:page_start,limit=end>page_end?end:page_end;
 char line[4096];unsigned long lo,hi,offset,inode;unsigned int major_number,minor_number;char permissions[5];int valid=1;
 while(cursor<limit&&fgets(line,sizeof line,maps)){
  if(sscanf(line,"%lx-%lx %4s %lx %x:%x %lu",&lo,&hi,permissions,&offset,&major_number,&minor_number,&inode)!=7)continue;
  if(hi<=cursor)continue;
  if(lo>cursor||strcmp(permissions,"r-xp")||inode!=(unsigned long)executable.st_ino||major_number!=major(executable.st_dev)||minor_number!=minor(executable.st_dev)){valid=0;break;}
  cursor=hi<limit?hi:limit;
 }
 int okay=valid&&cursor==limit&&!ferror(maps);if(fclose(maps))okay=0;return okay;
}
static void fatal_rx_failure(char *error,size_t capacity){
 static const char text[]="warmup_admission: RX restoration failed; aborting startup\n";
 fail_text(error,capacity,"fatal_rx_restoration_failed");
 ssize_t written=write(STDERR_FILENO,text,sizeof text-1);
 if(written<0){_exit(125);}
 _exit(125);
}
int warmup_admission_install(char *error,size_t capacity){
 int expected=0;if(!atomic_compare_exchange_strong(&install_attempted,&expected,1)){fail_text(error,capacity,"install_already_attempted_no_retry");return 0;}
 if(!one_main_thread()){fail_text(error,capacity,"requires_constructor_single_main_thread");return 0;}
 long value=sysconf(_SC_PAGESIZE);
 if(value<4096||((unsigned long)value&((unsigned long)value-1))){fail_text(error,capacity,"invalid_page_size");return 0;}
 const uintptr_t page_size=(uintptr_t)value,start=WARMUP_ADMISSION_SELECTOR_ADDRESS,end=start+sizeof warmup_selector_preimage,patch=WARMUP_ADMISSION_PATCH_ADDRESS;
 const uintptr_t page_start=patch&~(page_size-1),page_end=(patch+sizeof replacement+page_size-1)&~(page_size-1);
 if(page_end<=page_start||page_end-page_start!=page_size||!executable_private_rx(start,end,page_start,page_end)){fail_text(error,capacity,"selector_not_private_executable_rx_coverage");return 0;}
 unsigned char candidate[WARMUP_ADMISSION_SELECTOR_SIZE];
 if(!warmup_admission_prepare((const unsigned char *)start,sizeof candidate,candidate,sizeof candidate)){fail_text(error,capacity,"exact_selector_preimage_mismatch");return 0;}
 if(!one_main_thread()){fail_text(error,capacity,"thread_count_changed_before_patch");return 0;}
 if(mprotect((void *)page_start,page_size,PROT_READ|PROT_WRITE)){fail_text(error,capacity,"cannot_obtain_non_executable_rw_page");return 0;}
 /* No engine code can execute on this temporarily non-executable page under
  * the constructor/single-main-thread contract. No RWX mapping is requested. */
 if(memcmp((const void *)start,warmup_selector_preimage,sizeof warmup_selector_preimage)){
  if(mprotect((void *)page_start,page_size,PROT_READ|PROT_EXEC))fatal_rx_failure(error,capacity);
  fail_text(error,capacity,"preimage_changed_before_store");return 0;
 }
 memcpy((void *)patch,replacement,sizeof replacement);
 __builtin___clear_cache((char *)patch,(char *)(patch+sizeof replacement));
 if(mprotect((void *)page_start,page_size,PROT_READ|PROT_EXEC))fatal_rx_failure(error,capacity);
 if(!executable_private_rx(start,end,page_start,page_end)||!warmup_admission_is_candidate((const unsigned char *)start,sizeof candidate)){fail_text(error,capacity,"postpatch_exact_code_or_rx_verification_failed_abort_startup");return 0;}
 if(error&&capacity)error[0]=0;
 return 1;
}
