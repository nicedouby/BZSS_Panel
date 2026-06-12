export interface WebPagePermissionEntry {
  route: string;
  requiredPermission: string;
  legacyRequiredPermissions?: string[];
  superAdminOnly?: boolean;
}

export declare const WEB_PAGE_PERMISSION_MATRIX: readonly WebPagePermissionEntry[];

export declare function normalizeRoute(route: unknown): string;
export declare function normalizePermissionList(value: unknown): string[];
export declare function hasPermission(permissions: unknown, wanted: unknown): boolean;
export declare function canAccessPage(
  user: {
    permissions?: unknown;
    permission?: unknown;
    isSuperAdmin?: boolean;
    authorizationMode?: string;
  } | null | undefined,
  requiredPermission: unknown,
  legacyRequiredPermissions?: unknown,
  options?: {
    superAdminOnly?: boolean;
  },
): boolean;
export declare function resolveWebPagePermission(route: unknown): WebPagePermissionEntry | null;
