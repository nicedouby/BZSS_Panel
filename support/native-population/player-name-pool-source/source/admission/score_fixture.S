/* Standalone Linux x86-64 fixture wrapper. Executes only the 40-byte score
 * arithmetic/compare/cmov block extracted from ELF, never any UE call/address.
 * Args count,denominator,weight,best,team_id,selected; return best|selected<<32. */
.text
.globl fixture_native_score_step
.type fixture_native_score_step,@function
fixture_native_score_step:
 push %rbp
 push %rbx
 push %r12
 push %r13
 push %r15
 sub $0x380,%rsp
 mov %rsp,%r13
 lea 0x320(%rsp),%rax
 mov %rax,0x310(%r13)
 mov %edx,0x5c(%rax)
 mov %r9d,%ebp
 mov %r8d,%ebx
 mov %ecx,%r12d
 mov %esi,%r15d
 mov %edi,%eax
#include "score_step_bytes.generated.inc"
 mov %r12d,%eax
 mov %ebp,%edx
 shl $32,%rdx
 or %rdx,%rax
 add $0x380,%rsp
 pop %r15
 pop %r13
 pop %r12
 pop %rbx
 pop %rbp
 ret
.size fixture_native_score_step,.-fixture_native_score_step
.section .note.GNU-stack,"",@progbits
