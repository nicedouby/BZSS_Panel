import { createApp } from "vue";
import { createPinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";

import App from "./App.vue";
import { router } from "./app/router";
import { queryClient } from "./app/queryClient";
import { startRuntimeSync } from "./app/runtimeSync";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(VueQueryPlugin, { queryClient });
app.mount("#app");

startRuntimeSync();
