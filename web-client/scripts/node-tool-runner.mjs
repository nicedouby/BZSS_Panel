import { execFile } from "node:child_process";
import process from "node:process";

export function createStableNodeToolEnv(source = process.env) {
  const env = { ...source };

  // Node 26:
  // 閬垮厤澶栭儴 NODE_OPTIONS 褰卞搷瀛愯繘绋?
  delete env.NODE_OPTIONS;

  return env;
}

export function createNodeToolExecArgs({
  entry,
  args = [],
  nodeArgs = [],
  maxOldSpaceSizeMb = 4096,
} = {}) {
  const normalizedEntry = String(entry ?? "").trim();

  if (!normalizedEntry) {
    throw new Error("Node tool entry is required.");
  }

  const heapSize = Number.isFinite(Number(maxOldSpaceSizeMb))
    ? Math.max(1024, Math.round(Number(maxOldSpaceSizeMb)))
    : 4096;

  const extraNodeArgs = Array.isArray(nodeArgs)
    ? nodeArgs
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
    : [];

  const runtimeArgs = [
    `--max-old-space-size=${heapSize}`,
];

  for (const arg of extraNodeArgs) {
    if (!runtimeArgs.includes(arg)) {
      runtimeArgs.push(arg);
    }
  }

  const toolArgs = Array.isArray(args)
    ? args.map((v) => String(v))
    : [];

  return [
    ...runtimeArgs,
    normalizedEntry,
    ...toolArgs,
  ];
}

export async function runNodeTool({
  label,
  entry,
  args = [],
  nodeArgs = [],
  maxOldSpaceSizeMb = 4096,
}) {
  const toolLabel = String(label || "Node tool");

  const startedAt = Date.now();

  const execArgs = createNodeToolExecArgs({
    entry,
    args,
    nodeArgs,
    maxOldSpaceSizeMb,
  });

  const entryIndex = execArgs.indexOf(String(entry));

  console.log(
    `[client-build] Starting ${toolLabel} with Node ${process.version}`,
  );

  console.log(
    `[client-build] Runtime flags: ${
      entryIndex > 0
        ? execArgs.slice(0, entryIndex).join(" ")
        : ""
    }`,
  );

  const code = await runNodeToolProcess({
    toolLabel,
    execArgs,
  });

  const elapsed = Date.now() - startedAt;

  if (code === 0) {
    console.log(
      `[client-build] Finished ${toolLabel} in ${elapsed} ms`,
    );
  } else {
    console.error(
      `[client-build] ${toolLabel} failed with exit code ${code} after ${elapsed} ms.`,
    );

    console.error(
      `[client-build] Runtime: Node ${process.version}, platform ${process.platform} ${process.arch}`,
    );
  }

  return code;
}


async function runNodeToolProcess({
  toolLabel,
  execArgs,
}) {
  return await new Promise((resolve) => {

    const child = execFile(
      process.execPath,
      execArgs,
      {
        env: createStableNodeToolEnv(),
        windowsHide: false,
      },
      (error) => {

        if (error) {
          console.error(
            `[client-build] ${toolLabel} process error:`,
            error,
          );

          resolve(
            typeof error.code === "number"
              ? error.code
              : 1,
          );

          return;
        }

        resolve(0);
      },
    );


    if (child.stdout) {
      child.stdout.pipe(process.stdout);
    }

    if (child.stderr) {
      child.stderr.pipe(process.stderr);
    }


    child.once("error", (error) => {

      console.error(
        `[client-build] Unable to start ${toolLabel}:`,
        error,
      );

      resolve(1);

    });


    child.once("exit", (exitCode, signal) => {

      if (signal) {

        console.error(
          `[client-build] ${toolLabel} terminated by signal ${signal}.`,
        );

        resolve(1);
        return;

      }

      resolve(exitCode ?? 0);

    });

  });
}
