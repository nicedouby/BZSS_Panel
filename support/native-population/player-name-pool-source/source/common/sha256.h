#ifndef NT_SHA256_H
#define NT_SHA256_H
#include <stddef.h>
#include <stdint.h>
typedef struct { uint32_t h[8]; uint64_t bytes; unsigned char block[64]; size_t used; } nt_sha256;
void nt_sha256_init(nt_sha256 *s);
void nt_sha256_update(nt_sha256 *s, const void *data, size_t len);
void nt_sha256_final(nt_sha256 *s, unsigned char out[32]);
#endif
