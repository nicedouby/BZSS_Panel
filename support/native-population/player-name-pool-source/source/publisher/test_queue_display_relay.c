/* Harmless Linux/x86_64 relay ABI test. No game image, library or live patch.
 * Executes the actual 20-byte relay and an E8+NOP / MOV EBP,EAX callsite in
 * newly allocated private scratch memory. Does not test publication policy. */
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "Linux x86_64 standalone test only"
#endif

struct mock_gm { uintptr_t *vptr; int32_t raw; };
typedef int32_t (*original_fn)(struct mock_gm *);
typedef int32_t (*site_fn)(struct mock_gm *);
static unsigned checks, observed_calls, expected_calls, alternate_calls;
static unsigned callback_calls;
static uintptr_t expected_return;
static struct mock_gm *expected_this;
static original_fn expected_original;
static int32_t bonus;
static uintptr_t *swap_table;
#define CHECK(expr) do { ++checks; if (!(expr)) { fprintf(stderr,"check failed line %d: %s\n",__LINE__,#expr); exit(1); } } while (0)

static int32_t mock_expected(struct mock_gm *gm) {
 CHECK(gm==expected_this);
 ++observed_calls;
 ++expected_calls;
 if (swap_table) gm->vptr=swap_table;
 return gm->raw;
}
static int32_t mock_alternate(struct mock_gm *gm) {
 CHECK(gm==expected_this);
 ++observed_calls;
 ++alternate_calls;
 return gm->raw;
}

__attribute__((used,noinline))
int32_t relay_callback_impl(struct mock_gm *gm,original_fn observed,
                            uintptr_t return_pc,uintptr_t entry_alignment) {
 ++callback_calls;
 CHECK(gm==expected_this);
 CHECK(observed==expected_original);
 CHECK(return_pc==expected_return);
 CHECK((uintptr_t)__builtin_return_address(0)==expected_return);
 CHECK(entry_alignment==8);
 /* The captured original target is called once, with the original this. */
 int32_t raw=observed(gm);
 if (observed!=mock_expected || raw<0 || raw>100 || bonus>100-raw) return raw;
 return raw+bonus;
}

int32_t relay_callback_entry(struct mock_gm *,original_fn);
__asm__(
 ".text\n"
 ".type relay_callback_entry,@function\n"
 "relay_callback_entry:\n"
 "mov (%rsp),%rdx\n"
 "mov %rsp,%rcx\n"
 "and $15,%ecx\n"
 "jmp relay_callback_impl\n"
 ".size relay_callback_entry,.-relay_callback_entry\n"
);

/* Seed all SysV callee-saved registers around the real emitted callsite. */
int invoke_checked(struct mock_gm *,site_fn,int32_t *);
__asm__(
 ".text\n"
 ".type invoke_checked,@function\n"
 "invoke_checked:\n"
 "push %rbp\n push %rbx\n push %r12\n push %r13\n push %r14\n push %r15\n"
 "sub $24,%rsp\n"
 "mov %rsi,(%rsp)\n mov %rdx,8(%rsp)\n"
 "mov $0x11111111,%ebx\n mov $0x22222222,%ebp\n"
 "mov $0x33333333,%r12d\n mov $0x44444444,%r13d\n"
 "mov $0x55555555,%r14d\n mov $0x66666666,%r15d\n"
 "call *(%rsp)\n"
 "mov 8(%rsp),%rdx\n mov %eax,(%rdx)\n xor %eax,%eax\n"
 "cmp $0x11111111,%rbx\n jne 1f\n cmp $0x22222222,%rbp\n jne 1f\n"
 "cmp $0x33333333,%r12\n jne 1f\n cmp $0x44444444,%r13\n jne 1f\n"
 "cmp $0x55555555,%r14\n jne 1f\n cmp $0x66666666,%r15\n jne 1f\n"
 "mov $1,%eax\n"
 "1: add $24,%rsp\n"
 "pop %r15\n pop %r14\n pop %r13\n pop %r12\n pop %rbx\n pop %rbp\n ret\n"
 ".size invoke_checked,.-invoke_checked\n"
);

static uintptr_t original_address(original_fn fn) {
 uintptr_t value;
 _Static_assert(sizeof value==sizeof fn,"function pointer size");
 memcpy(&value,&fn,sizeof value);
 return value;
}

int main(void) {
 long pagesize=sysconf(_SC_PAGESIZE);
 CHECK(pagesize>=4096);
 unsigned char *page=mmap(NULL,(size_t)pagesize,PROT_READ|PROT_WRITE,
                         MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
 CHECK(page!=MAP_FAILED);
 /* Stub prologue preserves RBP and aligns RSP before the original callsite.
  * 55 | 48 8b 07 | E8 rel32 | 90 | 89 c5 | 89 e8 | 5d | c3 */
 unsigned char stub[]={0x55,0x48,0x8b,0x07,0xe8,0,0,0,0,0x90,
                       0x89,0xc5,0x89,0xe8,0x5d,0xc3};
 unsigned char relay[]={0x48,0x8b,0xb0,0xf0,0x07,0,0,
                        0x49,0xbb,0,0,0,0,0,0,0,0,0x41,0xff,0xe3};
 const size_t relay_offset=64;
 int32_t displacement=(int32_t)(relay_offset-9);
 memcpy(stub+5,&displacement,4);
 uintptr_t callback;
 int32_t (*entry)(struct mock_gm *,original_fn)=relay_callback_entry;
 _Static_assert(sizeof callback==sizeof entry,"callback pointer size");
 memcpy(&callback,&entry,8);
 memcpy(relay+9,&callback,8);
 memcpy(page,stub,sizeof stub);
 memcpy(page+relay_offset,relay,sizeof relay);
 CHECK(sizeof relay==20);
 CHECK(!memcmp(relay,"\x48\x8b\xb0\xf0\x07\x00\x00",7));
 CHECK(!memcmp(relay+17,"\x41\xff\xe3",3));
 CHECK(page[4]==0xe8 && page[9]==0x90);
 CHECK(page[10]==0x89 && page[11]==0xc5);
 CHECK((uintptr_t)(page+9)+(intptr_t)displacement==(uintptr_t)(page+relay_offset));
 CHECK(mprotect(page,(size_t)pagesize,PROT_READ|PROT_EXEC)==0);
 site_fn site;
 _Static_assert(sizeof site==sizeof page,"site pointer size");
 memcpy(&site,&page,sizeof site);
 uintptr_t expected_table[255]={0},alternate_table[255]={0};
 expected_table[0x7f0/8]=original_address(mock_expected);
 alternate_table[0x7f0/8]=original_address(mock_alternate);
 struct mock_gm gm={expected_table,0};
 expected_this=&gm;
 expected_return=(uintptr_t)(page+9); /* E8 return +5, immediately before NOP. */
 const int32_t raw_values[]={-1,0,1,98,99,100};
 for (size_t i=0;i<sizeof raw_values/sizeof raw_values[0];++i) {
  for (int32_t extra=0;extra<=99;extra+=33) {
   gm.vptr=expected_table;
   gm.raw=raw_values[i];
   expected_original=mock_expected;
   bonus=extra;
   swap_table=NULL;
   unsigned calls_before=observed_calls,callbacks_before=callback_calls;
   int32_t out=0;
   CHECK(invoke_checked(&gm,site,&out)==1);
   int32_t expected=gm.raw;
   if (gm.raw>=0 && gm.raw<=100 && bonus<=100-gm.raw) expected+=bonus;
   CHECK(out==expected);
   CHECK(observed_calls==calls_before+1 && callback_calls==callbacks_before+1);
  }
 }
 /* Original swaps this.vptr; this invocation still calls captured target
  * exactly once. The next invocation sees the alternate and passes through. */
 gm.raw=7;gm.vptr=expected_table;bonus=2;swap_table=alternate_table;
 expected_original=mock_expected;
 unsigned first_expected=expected_calls,first_alternate=alternate_calls;
 int32_t out=0;
 CHECK(invoke_checked(&gm,site,&out)==1 && out==9);
 CHECK(gm.vptr==alternate_table && expected_calls==first_expected+1 && alternate_calls==first_alternate);
 expected_original=mock_alternate;swap_table=NULL;
 CHECK(invoke_checked(&gm,site,&out)==1 && out==7);
 CHECK(expected_calls==first_expected+1 && alternate_calls==first_alternate+1);
 CHECK(munmap(page,(size_t)pagesize)==0);
 printf("{\"passed\":true,\"checks\":%u,\"callback_calls\":%u,\"original_calls\":%u,\"engine_calls\":0,\"game_image_loaded\":false,\"relay_bytes\":20}\n",
        checks,callback_calls,observed_calls);
 return 0;
}
