export async function execute(task, { reportProgress } = {}) {
  const ms = Math.max(0, Math.min(5000, Number(task.payload?.ms) || 10));
  reportProgress?.(25);
  await new Promise((resolve) => setTimeout(resolve, ms));
  reportProgress?.(100);
  return { sleptMs: ms };
}
