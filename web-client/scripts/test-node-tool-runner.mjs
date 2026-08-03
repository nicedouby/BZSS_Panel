import { spawn } from "node:child_process";
import process from "node:process";


export function createStableNodeToolEnv(source = process.env) {
  const env = { ...source };

  // 避免外部 NODE_OPTIONS 干扰 Node26 子进程
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


  const runtimeArgs = [];


  const heapSize = Number(maxOldSpaceSizeMb);


  if (Number.isFinite(heapSize)) {

    runtimeArgs.push(
      `--max-old-space-size=${Math.round(heapSize)}`
    );

  }



  if (Array.isArray(nodeArgs)) {

    for (const value of nodeArgs) {

      const arg = String(value ?? "").trim();


      if (!arg) {
        continue;
      }


      // Node26 不使用旧 V8 workaround
      if (arg === "--no-maglev") {
        continue;
      }


      if (!runtimeArgs.includes(arg)) {
        runtimeArgs.push(arg);
      }

    }

  }



  const toolArgs = Array.isArray(args)
    ? args.map((v)=>String(v))
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



  const entryIndex = execArgs.indexOf(
    String(entry)
  );



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





function runNodeToolProcess({
  toolLabel,
  execArgs,
}) {


  return new Promise((resolve)=>{


    const child = spawn(
      process.execPath,
      execArgs,
      {
        env:createStableNodeToolEnv(),
        windowsHide:false,
        stdio:"inherit",
      }
    );



    child.once(
      "error",
      (error)=>{

        console.error(
          `[client-build] Unable to start ${toolLabel}:`,
          error,
        );


        resolve(1);

      }
    );



    child.once(
      "exit",
      (exitCode, signal)=>{


        if(signal){

          console.error(
            `[client-build] ${toolLabel} terminated by signal ${signal}.`
          );


          resolve(1);

          return;
        }



        resolve(
          exitCode ?? 1
        );

      }
    );


  });

}