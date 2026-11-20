/* Included after bootstrap_helpers.inc. Startup only, fixed ELF, no worker.
 * The existing full executable hash gate runs before this optional hook. */
static int qd_patched;
static uintptr_t qd_relay_va;

static const char *install_queue_display(void) {
    const char *setting=getenv("WARMUP_QUEUE_DISPLAY_MODE");
    int mode=QD_OFF;
    if (setting && strcmp(setting,"off")) {
        if (!strcmp(setting,"observe")) mode=QD_OBSERVE;
        else if (!strcmp(setting,"apply")) mode=QD_APPLY;
        else return "queue_display_mode_invalid";
    }
    if (!warmup_queue_display_configure(mode)) return "queue_display_configure_failed";
    if (mode==QD_OFF) return NULL;
    if (!only_startup_thread()) return "queue_display_not_startup_thread";
    if (strcmp(PINNED_ELF_SHA,QD_PINNED_ELF_SHA)) return "queue_display_elf_pin_mismatch";
    int fd=open("/proc/self/exe",O_RDONLY|O_CLOEXEC);
    if (fd<0) return "queue_display_exe_open_failed";
    Elf64_Ehdr eh;Elf64_Phdr ph[64];
    int valid=exact_read(fd,&eh,sizeof eh,0) && eh.e_phnum && eh.e_phnum<=64 &&
        eh.e_phentsize==sizeof(Elf64_Phdr) &&
        exact_read(fd,ph,eh.e_phnum*sizeof *ph,(off_t)eh.e_phoff);
    close(fd);
    if (!valid || !in_rx_segment(ph,eh.e_phnum,QD_PRODUCER_VA,QD_PRODUCER_SIZE) ||
        !in_rx_segment(ph,eh.e_phnum,QD_ORIGINAL_VA,QD_ORIGINAL_SIZE))
        return "queue_display_code_segment_mismatch";
    if (!memory_hash(QD_PRODUCER_VA,QD_PRODUCER_SIZE,QD_PRODUCER_SHA) ||
        !memory_hash(QD_ORIGINAL_VA,QD_ORIGINAL_SIZE,QD_ORIGINAL_SHA) ||
        memcmp((const void *)QD_CONTEXT_VA,qd_original_context,sizeof qd_original_context) ||
        memcmp((const void *)QD_CALLSITE_VA,qd_original_call,sizeof qd_original_call))
        return "queue_display_code_fingerprint_mismatch";
    long page_size=sysconf(_SC_PAGESIZE);
    if (page_size<=0 || (page_size&(page_size-1))) return "queue_display_page_size_invalid";
    const uintptr_t page=QD_CALLSITE_VA&~((uintptr_t)page_size-1);
    if (QD_RESUME_VA>page+(uintptr_t)page_size) return "queue_display_cross_page_site";
    unsigned char *relay=mmap(NULL,(size_t)page_size,PROT_READ|PROT_WRITE,
        MAP_PRIVATE|MAP_ANONYMOUS|MAP_32BIT,-1,0);
    if (relay==MAP_FAILED) return "queue_display_relay_mmap_failed";
    int64_t delta=(int64_t)(uintptr_t)relay-(int64_t)QD_HOOK_RETURN_VA;
    if (delta<INT32_MIN || delta>INT32_MAX) {
        munmap(relay,(size_t)page_size);return "queue_display_relay_out_of_range";
    }
    /* mov rsi,[rax+7f0]; movabs r11,hook; jmp r11.
     * Original RDI=this and CALL stack are unchanged. Capture the actual
     * virtual dispatch before entering C; do not substitute a global target. */
    unsigned char code[]={0x48,0x8b,0xb0,0xf0,0x07,0x00,0x00,
        0x49,0xbb,0,0,0,0,0,0,0,0,0x41,0xff,0xe3};
    uintptr_t hook=(uintptr_t)warmup_queue_display_hook;
    memcpy(code+9,&hook,8);memcpy(relay,code,sizeof code);
    if (mprotect(relay,(size_t)page_size,PROT_READ|PROT_EXEC)) {
        munmap(relay,(size_t)page_size);return "queue_display_relay_rx_failed";
    }
    unsigned char replacement[6]={0xe8,0,0,0,0,0x90};
    int32_t disp=(int32_t)delta;memcpy(replacement+1,&disp,4);
    /* No engine code executes during this single-thread startup window. */
    if (memcmp((const void *)QD_CALLSITE_VA,qd_original_call,sizeof qd_original_call) ||
        mprotect((void *)page,(size_t)page_size,PROT_READ|PROT_WRITE)) {
        munmap(relay,(size_t)page_size);return "queue_display_callsite_prepare_failed";
    }
    memcpy((void *)QD_CALLSITE_VA,replacement,sizeof replacement);
    __builtin___clear_cache((char *)QD_CALLSITE_VA,(char *)QD_RESUME_VA);
    if (mprotect((void *)page,(size_t)page_size,PROT_READ|PROT_EXEC) ||
        memcmp((const void *)QD_CALLSITE_VA,replacement,sizeof replacement)) _exit(126);
    qd_relay_va=(uintptr_t)relay;qd_patched=1;
    return NULL;
}
