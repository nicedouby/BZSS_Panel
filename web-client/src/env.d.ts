/// <reference types="vite/client" />

declare module "vue-virtual-scroller";

import "@vue/runtime-core";

declare module "@vue/runtime-core" {
  export interface ComponentCustomDirectives {
    "backdrop-close": any;
  }
}
