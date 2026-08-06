import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import "./styles/themes.css";
import "./styles/reset.css";
import "./styles/base.css";
import "./styles/primitives.css";
import "./styles/utilities.css";
import "./styles/squad-admin.css";
import "./styles/simple-plugin-page.css";
import "./styles/logpost-diagnostics-fixed.css";

import { renderFatalBootError, isResizeObserverError } from "./app/bootError";

window.addEventListener("error", (event) => {
  const err = event.error ?? event.message;
  if (isResizeObserverError(err)) return;
  renderFatalBootError(err);
});

window.addEventListener("unhandledrejection", (event) => {
  if (isResizeObserverError(event.reason)) return;
  renderFatalBootError(event.reason);
});

async function bootstrap() {
  try {
    const [{ default: App }, { router }, { queryClient }] = await Promise.all([
      import("./App.vue"),
      import("./app/router"),
      import("./app/queryClient"),
    ]);

    const app = createApp(App);
    app.use(createPinia());
    app.use(router);
    app.use(VueQueryPlugin, { queryClient });
    
    const { backdropCloseDirective } = await import("./directives/backdrop-close");
    app.directive("backdrop-close", backdropCloseDirective);

    app.config.errorHandler = (error) => {
      if (isResizeObserverError(error)) return;
      renderFatalBootError(error);
      console.error("[vue] unhandled error", error);
    };
    app.mount("#app");
  } catch (error) {
    renderFatalBootError(error);
    console.error("[bootstrap] failed", error);
  }
}

void bootstrap();
