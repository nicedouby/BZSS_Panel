/* Exact publisher callsite verification/installation adapted from the
 * previously accepted attempt3 publisher. No worker or fixed-count arm. */
static int exact_read(int fd, void *out, size_t size, off_t at) {
    unsigned char *p = out;
    while (size) {
        ssize_t n = pread(fd, p, size, at);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return 0;
        p += n; size -= (size_t)n; at += n;
    }
    return 1;
}
static void digest_hex(const unsigned char digest[32], char hex[65]) {
    static const char digits[] = "0123456789abcdef";
    for (int i = 0; i < 32; ++i) { hex[2*i] = digits[digest[i] >> 4]; hex[2*i+1] = digits[digest[i] & 15]; }
    hex[64] = 0;
}
static int memory_hash(uintptr_t at, size_t size, const char *expected) {
    nt_sha256 s; unsigned char d[32]; char h[65];
    nt_sha256_init(&s); nt_sha256_update(&s, (const void *)at, size); nt_sha256_final(&s, d);
    digest_hex(d, h); return !strcmp(h, expected);
}
static int in_rx_segment(const Elf64_Phdr *ph, unsigned n, uintptr_t at, size_t size) {
    for (unsigned i = 0; i < n; ++i) if (ph[i].p_type == PT_LOAD && ph[i].p_flags == (PF_R | PF_X) &&
        at >= ph[i].p_vaddr && size <= ph[i].p_memsz && at - ph[i].p_vaddr <= ph[i].p_memsz - size) return 1;
    return 0;
}
static int only_startup_thread(void) {
    DIR *dir = opendir("/proc/self/task"); if (!dir) return 0;
    unsigned count = 0; struct dirent *e;
    while ((e = readdir(dir))) if (e->d_name[0] != '.') ++count;
    closedir(dir); return count == 1;
}
static int start_ticks(unsigned long long *ticks) {
    int fd = open("/proc/self/stat", O_RDONLY | O_CLOEXEC); if (fd < 0) return 0;
    char b[4096]; ssize_t n = read(fd, b, sizeof b - 1); close(fd);
    if (n <= 0) return 0;
    b[n] = 0;
    char *p = strrchr(b, ')'); if (!p || p[1] != ' ') return 0; p += 2;
    for (int field = 3; field < 22; ++field) { p = strchr(p, ' '); if (!p) return 0; ++p; }
    errno = 0; char *end; *ticks = strtoull(p, &end, 10);
    return !errno && end != p && *ticks && (*end == ' ' || *end == '\n');
}
static int protected_dir(const char *path, uid_t owner) {
    struct stat s;
    return !lstat(path, &s) && S_ISDIR(s.st_mode) && s.st_uid == owner && !(s.st_mode & 0022);
}
static int marker_gate(void) {
    const char *enabled = getenv("WARMUP_INTEGRATED_ENABLE");
    if (!enabled || strcmp(enabled, "1") || !protected_dir(LAB_DIR, 0) ||
        !protected_dir(STATE_DIR, geteuid())) return 0;
    int fd = open(MARKER, O_RDONLY | O_CLOEXEC | O_NOFOLLOW); if (fd < 0) return 0;
    struct stat s; char b[sizeof MARKER_TEXT];
    int ok = !fstat(fd, &s) && S_ISREG(s.st_mode) && s.st_uid == 0 && s.st_nlink == 1 &&
        !(s.st_mode & 0022) && s.st_size == (off_t)(sizeof MARKER_TEXT - 1);
    ssize_t n = ok ? read(fd, b, sizeof b) : -1; close(fd);
    return ok && n == (ssize_t)(sizeof MARKER_TEXT - 1) && !memcmp(b, MARKER_TEXT, sizeof MARKER_TEXT - 1);
}
static const char *verify_elf_and_code(void) {
    int fd = open("/proc/self/exe", O_RDONLY | O_CLOEXEC); if (fd < 0) return "exe_open_failed";
    Elf64_Ehdr eh; Elf64_Phdr ph[64];
    if (!exact_read(fd, &eh, sizeof eh, 0) || memcmp(eh.e_ident, ELFMAG, SELFMAG) ||
        eh.e_ident[EI_CLASS] != ELFCLASS64 || eh.e_ident[EI_DATA] != ELFDATA2LSB ||
        eh.e_type != ET_EXEC || eh.e_machine != EM_X86_64 || eh.e_phentsize != sizeof(Elf64_Phdr) ||
        !eh.e_phnum || eh.e_phnum > 64 || !exact_read(fd, ph, eh.e_phnum * sizeof *ph, (off_t)eh.e_phoff)) {
        close(fd); return "elf_type_mismatch";
    }
    nt_sha256 s; unsigned char b[65536], d[32]; char h[65]; nt_sha256_init(&s);
    for (;;) {
        ssize_t n = read(fd, b, sizeof b);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) { close(fd); return "exe_read_failed"; }
        if (!n) break;
        nt_sha256_update(&s, b, (size_t)n);
    }
    close(fd); nt_sha256_final(&s, d); digest_hex(d, h);
    if (strcmp(h, PINNED_ELF_SHA)) return "elf_sha_mismatch";
    if (!in_rx_segment(ph, eh.e_phnum, PRODUCER_VA, PRODUCER_SIZE) ||
        !in_rx_segment(ph, eh.e_phnum, HELPER_VA, HELPER_SIZE)) return "code_segment_mismatch";
    if (!memory_hash(PRODUCER_VA, PRODUCER_SIZE, PRODUCER_SHA) ||
        !memory_hash(HELPER_VA, HELPER_SIZE, HELPER_SHA) ||
        memcmp((const void *)CONTEXT_VA, original_context, sizeof original_context) ||
        memcmp((const void *)CALLSITE_VA, original_call, sizeof original_call)) return "code_fingerprint_mismatch";
    callsite_verified = 1;
    return NULL;
}
static const char *install_callsite(void) {
    long page_size = sysconf(_SC_PAGESIZE);
    if (page_size <= 0 || (page_size & (page_size - 1))) return "page_size_invalid";
    if (!only_startup_thread()) return "startup_not_single_thread";
    unsigned char *relay = mmap(NULL, (size_t)page_size, PROT_READ | PROT_WRITE,
                                MAP_PRIVATE | MAP_ANONYMOUS | MAP_32BIT, -1, 0);
    if (relay == MAP_FAILED) return "near_relay_mmap_failed";
    int64_t delta = (int64_t)(uintptr_t)relay - (int64_t)RETURN_VA;
    if (delta < INT32_MIN || delta > INT32_MAX) { munmap(relay, (size_t)page_size); return "relay_out_of_rel32_range"; }
    /* 49 89 d8: mov r8,rbx; 49 bb imm64: movabs r11,hook;
     * 41 ff e3: jmp r11. Only caller-saved registers are changed. */
    unsigned char code[] = {0x49,0x89,0xd8,0x49,0xbb,0,0,0,0,0,0,0,0,0x41,0xff,0xe3};
    uintptr_t hook = (uintptr_t)warmup_playercount_hook; memcpy(code + 5, &hook, 8); memcpy(relay, code, sizeof code);
    if (mprotect(relay, (size_t)page_size, PROT_READ | PROT_EXEC)) { munmap(relay, (size_t)page_size); return "relay_rx_failed"; }
    uintptr_t page = CALLSITE_VA & ~((uintptr_t)page_size - 1);
    unsigned char replacement[5] = {0xe8}; int32_t disp = (int32_t)delta; memcpy(replacement + 1, &disp, 4);
    if (mprotect((void *)page, (size_t)page_size, PROT_READ | PROT_WRITE)) { munmap(relay, (size_t)page_size); return "callsite_rw_failed"; }
    /* Constructor, before main, one thread, no engine code can execute here. */
    memcpy((void *)CALLSITE_VA, replacement, sizeof replacement);
    __builtin___clear_cache((char *)CALLSITE_VA, (char *)RETURN_VA);
    if (mprotect((void *)page, (size_t)page_size, PROT_READ | PROT_EXEC)) _exit(126);
    if (memcmp((const void *)CALLSITE_VA, replacement, sizeof replacement)) _exit(126);
    relay_va = (uintptr_t)relay; patched = 1;
    return NULL;
}
