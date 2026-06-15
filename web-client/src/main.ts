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

import { renderFatalBootError } from "./app/bootError";

window.addEventListener("error", (event) => {
  renderFatalBootError(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
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
    app.config.errorHandler = (error) => {
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
