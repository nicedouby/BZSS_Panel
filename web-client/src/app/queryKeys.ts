export const queryKeys = {
  console: {
    channels: (stream: string) => ["console-channels", stream] as const,
    lines: (stream: string, scope: string, level: string, q: string) =>
      ["console-lines", stream, scope, level, q] as const,
  },
  web: {
    pages: () => ["web-pages"] as const,
  },
};
