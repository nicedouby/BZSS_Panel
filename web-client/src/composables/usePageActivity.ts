import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  onScopeDispose,
  ref,
} from "vue";

export function usePageActivity() {
  const isActivated = ref(false);
  const isDocumentVisible = ref(typeof document === "undefined" ? true : !document.hidden);

  function syncVisibility() {
    isDocumentVisible.value = typeof document === "undefined" ? true : !document.hidden;
  }

  function handleMounted() {
    isActivated.value = true;
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
  }

  function handleUnmount() {
    isActivated.value = false;
    document.removeEventListener("visibilitychange", syncVisibility);
  }

  onMounted(handleMounted);
  onActivated(() => {
    isActivated.value = true;
    syncVisibility();
  });
  onDeactivated(() => {
    isActivated.value = false;
  });
  onBeforeUnmount(handleUnmount);
  onScopeDispose(handleUnmount);

  return {
    isActivated,
    isDocumentVisible,
    canPoll: computed(() => isActivated.value && isDocumentVisible.value),
  };
}
