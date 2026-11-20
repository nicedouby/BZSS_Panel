#ifndef WARMUP_ADMISSION_H
#define WARMUP_ADMISSION_H
#include <stddef.h>
#include <stdint.h>

/* Called once by the root constructor(101), after its exact ELF SHA gate and
 * before any engine initialization, network callbacks, GT or worker thread.
 * No own constructor, thread, environment, engine call, counter or identity write.
 * On ordinary failure returns0 and caller must abort bootstrap/process startup.
 * An inability to restore RX after RW is fatal (_exit125), never live recovery.
 * There is intentionally no runtime uninstall or retry API. */
int warmup_admission_install(char *error, size_t error_capacity);

/* Pure buffer contract for standalone fixtures; never touches target memory. */
size_t warmup_admission_selector_size(void);
int warmup_admission_prepare(const unsigned char *original, size_t size,
                             unsigned char *candidate, size_t capacity);
int warmup_admission_is_candidate(const unsigned char *code, size_t size);

#define WARMUP_ADMISSION_SELECTOR_ADDRESS UINT64_C(0xa54af10)
#define WARMUP_ADMISSION_SELECTOR_SIZE 1568U
#define WARMUP_ADMISSION_PATCH_ADDRESS UINT64_C(0xa54b2cd)
#define WARMUP_ADMISSION_PATCH_OFFSET 957U
#define WARMUP_ADMISSION_PATCH_SIZE 4U
#endif
