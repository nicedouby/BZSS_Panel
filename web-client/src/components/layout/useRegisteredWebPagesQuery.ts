import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";

import { apiGet } from "../../app/apiClient";
import { queryKeys } from "../../app/queryKeys";
import type { RegisteredWebPage } from "../../app/sidebarNav";
import { useAuthStore } from "../../stores/auth.store";

export function useRegisteredWebPagesQuery() {
  const auth = useAuthStore();

  return useQuery({
    queryKey: computed(() => [
      ...queryKeys.web.pages(),
      auth.user?.id ?? "guest",
      auth.user?.permissions?.join("|") ?? "",
      auth.user?.isSuperAdmin ? "super-admin" : "regular",
    ]),
    queryFn: async () => {
      const response = await apiGet<{ pages?: RegisteredWebPage[] }>("/api/web/pages");
      return Array.isArray(response.pages) ? response.pages : [];
    },
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
  });
}
