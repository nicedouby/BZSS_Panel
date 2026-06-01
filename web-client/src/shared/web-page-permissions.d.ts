export interface WebPagePermissionEntry {
  route: string;
  requiredPermission: string;
  legacyRequiredPermissions?: string[];
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
  } | null | undefined,
  requiredPermission: unknown,
  legacyRequiredPermissions?: unknown,
): boolean;
export declare function resolveWebPagePermission(route: unknown): WebPagePermissionEntry | null;
