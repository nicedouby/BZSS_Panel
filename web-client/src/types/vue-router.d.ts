import "vue-router";

import type {
  ContentPadding,
  LayoutMode,
  PageCategory,
  RefreshPolicy,
} from "../app/pageRegistry";

declare module "vue-router" {
  interface RouteMeta {
    title?: string;
    titleKey?: string;
    category?: PageCategory;
    refreshPolicy?: RefreshPolicy;
    layoutMode?: LayoutMode;
    contentPadding?: ContentPadding;
    requiredPermission?: string;
    legacyRequiredPermissions?: string[];
    superAdminOnly?: boolean;
    fullBleed?: boolean;
  }
}
