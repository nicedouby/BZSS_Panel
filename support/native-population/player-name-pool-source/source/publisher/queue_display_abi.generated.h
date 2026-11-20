/* Generated offline from fixed ELF SHA86770...148d5. No patch is applied.
 * Replace only the 6-byte indirect CALL with E8 rel32 + NOP at startup.
 * Relay: RSI=[RAX+0x7f0], R11=callback, JMP R11; preserve original RDI=this.
 * SysV callback: int32_t callback(void *gm, int32_t (*observed)(void *gm)).
 * Call observed(gm) exactly once; only alter EAX after the original returns.
 * For E8+NOP, callback return PC is site+5, then NOP reaches site+6.
 * All preserved-register, stack and original-call contracts remain required.
 */
#pragma once
#include <stdint.h>
#define QD_PINNED_ELF_SHA "86770cae6d030e37ab9e435e753e7e76ff59e6853190671627af771e02c148d5"
#define QD_PRODUCER_VA ((uintptr_t)0xa54b990)
#define QD_PRODUCER_SIZE 1009U
#define QD_PRODUCER_SHA "81a5de633d7871c25b182e1323262f60902ac3dce64581d02cfddb9627a56d6a"
#define QD_ORIGINAL_VA ((uintptr_t)0xa4faf70)
#define QD_ORIGINAL_SIZE 209U
#define QD_ORIGINAL_SHA "20caf011d28fd4e953cd4d222886b68be5b8c2b9eb84c745827692531b38c91f"
#define QD_CALLSITE_VA ((uintptr_t)0xa54b9c0)
#define QD_RESUME_VA ((uintptr_t)0xa54b9c6)
#define QD_HOOK_RETURN_VA ((uintptr_t)0xa54b9c5)
#define QD_CONTEXT_VA ((uintptr_t)0xa54b9ae)
static const unsigned char qd_original_call[6]={0xff,0x90,0xf0,0x07,0x00,0x00};
static const unsigned char qd_original_context[26]={0x48,0x89,0xdf,0xe8,0xba,0x72,0x4a,0xfd,0x48,0x8b,0xb8,0xd8,0x01,0x00,0x00,0x48,0x8b,0x07,0xff,0x90,0xf0,0x07,0x00,0x00,0x89,0xc5};
