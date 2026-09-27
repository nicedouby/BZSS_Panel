export function resolvePythonExecutable(configuredExecutable, platform = process.platform) {
  const configured = String(configuredExecutable ?? "").trim();
  if (platform !== "win32" && (!configured || configured.toLowerCase() === "python")) {
    return "python3";
  }
  return configured || "python";
}
