import { $ } from "bun";

// --- SECURITY WARNING: Blacklist is less secure than a whitelist ---
const BLOCKED_COMMANDS = [
  "rm",
  "mv",
  "shutdown",
  "reboot",
  "halt",
  "chmod",
  "chown",
  "del",
  "dd",
];

export async function executeCommand(command: string): Promise<string> {
  // --- SECURITY: Check if any part of the command is in the blacklist ---
  const commandParts = command.trim().split(/["\s&|;]+/);
  const isBlocked = commandParts.some((part) =>
    BLOCKED_COMMANDS.includes(part),
  );

  if (isBlocked) {
    console.warn(`Blocked potentially dangerous command attempt: ${command}`);
    return "Error: Command contains a blocked term.";
  }

  try {
    const { stdout, stderr, exitCode } = await $`${command}`.nothrow();

    if (exitCode !== 0) {
      return `Error (Exit Code: ${exitCode}):\n${stderr.toString()}`;
    }

    const output = stdout.toString();
    return (
      output.trim() || "Command executed successfully, but produced no output."
    );
  } catch (error) {
    if (error instanceof Error) {
      return `Execution failed:\n${error.message}`;
    }
    return "An unknown execution error occurred.";
  }
}
