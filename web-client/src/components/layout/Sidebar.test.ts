import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("./useRegisteredWebPagesQuery", async () => {
  const { shallowRef } = await import("vue");
  const data = shallowRef([]);
  return {
    useRegisteredWebPagesQuery: () => ({ data }),
  };
});

import Sidebar from "./StableSidebar.vue";
import { useAuthStore } from "../../stores/auth.store";
import { useUiStore } from "../../stores/ui.store";

function installMatchMedia(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  vi.stubGlobal("matchMedia", (query: string) => {
    const maxWidth = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: !maxWidth || width <= Number(maxWidth[1]),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  });
}

async function mountSidebar(width = 1200) {
  installMatchMedia(width);
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.checked = true;
  auth.authenticated = true;
  auth.user = {
    id: "1",
    username: "admin",
    role: "admin",
    isSuperAdmin: true,
    permissions: [],
  } as any;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: "/:pathMatch(.*)*",
      component: { template: "<div />" },
    }],
  });
  await router.push("/match-status");
  await router.isReady();

  const wrapper = mount(Sidebar, {
    global: { plugins: [pinia, router] },
  });
  await flushPromises();
  return { wrapper, router, ui: useUiStore() };
}

describe("Sidebar navigation interaction", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("expands a primary section without changing the current route", async () => {
    const { wrapper, router } = await mountSidebar();
    const section = wrapper.find('[data-section="analytics"]');
    expect(section.exists()).toBe(true);

    await section.find("button.section-link").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/match-status");
    expect(section.find(".section-children").exists()).toBe(true);
    wrapper.unmount();
  });

  it("expands the desktop sidebar before opening a collapsed section", async () => {
    const { wrapper, ui } = await mountSidebar(1200);
    ui.setSidebarCollapsed(true);
    await flushPromises();

    const section = wrapper.find('[data-section="combat"]');
    await section.find("button.section-link").trigger("click");
    await flushPromises();

    expect(ui.sidebarCollapsed).toBe(false);
    expect(section.find(".section-children").exists()).toBe(true);
    wrapper.unmount();
  });

  it.each([1024, 1050, 1100, 1200])(
    "keeps child pages reachable at %dpx",
    async (width) => {
      const { wrapper } = await mountSidebar(width);
      const section = wrapper.find('[data-section="analytics"]');
      await section.find("button.section-link").trigger("click");
      await flushPromises();

      expect(section.findAll(".child-link").length).toBeGreaterThan(0);
      wrapper.unmount();
    },
  );

  it("closes the navigation drawer only after a child page is selected", async () => {
    const { wrapper, router, ui } = await mountSidebar(1050);
    ui.openMobileSidebar();
    await flushPromises();

    const section = wrapper.find('[data-section="combat"]');
    await section.find("button.section-link").trigger("click");
    expect(ui.mobileSidebarOpen).toBe(true);

    const child = section.find(".child-link");
    expect(child.exists()).toBe(true);
    await child.trigger("click");
    await flushPromises();

    expect(ui.mobileSidebarOpen).toBe(false);
    expect(router.currentRoute.value.path).not.toBe("/match-status");
    wrapper.unmount();
  });
});
