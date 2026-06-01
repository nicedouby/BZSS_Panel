export function normalizeRconCommandName(commandText: unknown): string;
export function resolveRconPermission(commandText: unknown, options?: {
  requiredPermission?: unknown;
  permission?: unknown;
  permissionKey?: unknown;
  rconPermission?: unknown;
  commandPermission?: unknown;
}): string;
export function canSendRconCommand(
  user: {
    permissions?: unknown;
    permission?: unknown;
    isSuperAdmin?: boolean;
  } | null | undefined,
  commandText: unknown,
  options?: {
    requiredPermission?: unknown;
    permission?: unknown;
    permissionKey?: unknown;
    rconPermission?: unknown;
    commandPermission?: unknown;
  },
): boolean;
export function hasPermission(permissions: unknown, wanted: unknown): boolean;
export function normalizePermissionList(value: unknown): string[];
