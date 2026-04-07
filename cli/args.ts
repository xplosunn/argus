export interface CliOptions {
  command?: string;
  port: number;
  defaultBranch?: string;
  repoPath?: string;
  showHelp: boolean;
}

export function parseArgs(args: string[]): CliOptions {
  if (args.length === 0) {
    return {
      command: undefined,
      port: 0,
      defaultBranch: undefined,
      showHelp: true
    };
  }

  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    return {
      command: undefined,
      port: 0,
      defaultBranch: undefined,
      showHelp: true
    };
  }

  const command = args[0];
  let port = 0;
  let defaultBranch: string | undefined;
  let repoPath: string | undefined;
  let showHelp = false;

  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--help" || token === "-h") {
      showHelp = true;
      continue;
    }

    if (token === "--port") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--port requires a value.");
      }

      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 65_535) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      port = parsed;
      index += 1;
      continue;
    }

    if (token === "--default-branch") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--default-branch requires a value.");
      }

      defaultBranch = value;
      index += 1;
      continue;
    }

    if (token === "--repo") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--repo requires a value.");
      }

      repoPath = value;
      index += 1;
    }
  }

  return {
    command,
    port,
    defaultBranch,
    repoPath,
    showHelp
  };
}
