import { spawn } from "child_process";
import { sessionManager, InteractiveSession } from "./session";
import { Context } from "hono";
import { sendWhatsappMessage } from "./whatsapp";

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
  "mkfs",
  "fdisk",
  "parted",
];

// Commands that typically require interactive input
const INTERACTIVE_COMMANDS = [
  "sudo",
  "ssh",
  "scp",
  "mysql",
  "psql",
  "passwd",
  "su",
  "ftp",
  "sftp",
  "telnet",
  "ping", // for continuous ping
  "apt",
  "apt-get",
  "yum",
  "dnf",
  "pacman",
  "zypper",
  "snap",
  "pip",
  "npm",
  "yarn",
];

export async function executeCommand(
  command: string,
  phone: string,
  c: Context,
): Promise<string> {
  // --- SECURITY: Check if any part of the command is in the blacklist ---
  const commandParts = command.trim().split(/[\s&|;]+/);
  const isBlocked = commandParts.some((part) =>
    BLOCKED_COMMANDS.includes(part),
  );

  if (isBlocked) {
    console.warn(`Blocked potentially dangerous command attempt: ${command}`);
    return "❌ Error: Command contains a blocked term.";
  }

  // Check if this is a special control command
  if (command.toLowerCase() === "exit" || command.toLowerCase() === "quit") {
    sessionManager.endSession(phone);
    return "✅ Session ended.";
  }

  if (command.toLowerCase() === "sessions") {
    const session = sessionManager.getSession(phone);
    if (session) {
      return `📋 Active session: ${session.command}\n⏰ Created: ${session.createdAt.toISOString()}\n🔄 Waiting for input: ${session.isWaitingForInput ? "Yes" : "No"}`;
    }
    return "📋 No active sessions.";
  }

  // Check if user has an active session waiting for input
  const existingSession = sessionManager.getSession(phone);
  if (
    existingSession &&
    existingSession.isWaitingForInput &&
    existingSession.process
  ) {
    return await handleInteractiveInput(existingSession, command, c);
  }

  // Check if this is a potentially interactive command
  const isInteractiveCommand = INTERACTIVE_COMMANDS.some((cmd) =>
    command.trim().toLowerCase().startsWith(cmd.toLowerCase()),
  );

  if (isInteractiveCommand) {
    return await executeInteractiveCommand(command, phone, c);
  } else {
    return await executeNonInteractiveCommand(command);
  }
}

async function executeNonInteractiveCommand(command: string): Promise<string> {
  try {
    const proc = Bun.spawn(["/bin/bash", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return `❌ Error (Exit Code: ${exitCode}):\n${stderr.trim()}`;
    }

    return (
      stdout.trim() ||
      "✅ Command executed successfully, but produced no output."
    );
  } catch (error) {
    if (error instanceof Error) {
      return `❌ Execution failed:\n${error.message}`;
    }
    return "❌ An unknown execution error occurred.";
  }
}

async function executeInteractiveCommand(
  command: string,
  phone: string,
  c: Context,
): Promise<string> {
  // End any existing session first
  sessionManager.endSession(phone);

  const sessionId = sessionManager.createSession(phone, command);

  return new Promise((resolve) => {
    let output = "";
    let hasReceivedOutput = false;
    let outputTimer: NodeJS.Timeout;

    // Modify command for better interactive handling
    let finalCommand = command;

    // Special handling for SSH
    if (command.trim().startsWith("ssh")) {
      finalCommand = command.replace(
        "ssh",
        "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o NumberOfPasswordPrompts=3 -o ConnectTimeout=10",
      );
    }

    const childProcess = spawn("/bin/bash", ["-c", finalCommand], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });

    sessionManager.setProcess(sessionId, childProcess);

    // Handle stdout
    childProcess.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      hasReceivedOutput = true;

      console.log(`Interactive stdout from ${phone}: ${chunk}`);

      // Reset the timer whenever we receive output
      clearTimeout(outputTimer);
      outputTimer = setTimeout(() => {
        checkForInputRequest(sessionId, phone, c, output, resolve);
      }, 800); // Wait 800ms after last output
    });

    // Handle stderr
    childProcess.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();

      // Filter out apt CLI warnings but keep other stderr
      if (
        !chunk.includes("WARNING: apt does not have a stable CLI interface")
      ) {
        output += chunk;
        hasReceivedOutput = true;

        console.log(`Interactive stderr from ${phone}: ${chunk}`);

        // Reset the timer whenever we receive output
        clearTimeout(outputTimer);
        outputTimer = setTimeout(() => {
          checkForInputRequest(sessionId, phone, c, output, resolve);
        }, 800);
      }
    });

    // Handle process exit
    childProcess.on("exit", (code, signal) => {
      clearTimeout(outputTimer);
      sessionManager.endSession(phone);

      // Handle SSH specific failures
      if (code === 255 && command.includes("ssh")) {
        if (output.includes("Permission denied")) {
          resolve(
            `❌ SSH Authentication failed. The password was incorrect or the user doesn't exist.\n\nTry the command again:\n\`\`\`\n${output}\n\`\`\``,
          );
        } else if (output.includes("Connection refused")) {
          resolve(
            `❌ SSH Connection refused. Check if SSH service is running on the target host.\n\n\`\`\`\n${output}\n\`\`\``,
          );
        } else {
          resolve(
            `❌ SSH failed (Exit Code: ${code})\n\n\`\`\`\n${output}\n\`\`\``,
          );
        }
      } else if (!hasReceivedOutput) {
        resolve(`✅ Command completed (Exit Code: ${code})`);
      } else {
        resolve(
          `✅ Command completed (Exit Code: ${code})\n\n\`\`\`\n${output}\n\`\`\``,
        );
      }
    });

    // Handle errors
    childProcess.on("error", (error) => {
      clearTimeout(outputTimer);
      sessionManager.endSession(phone);
      resolve(`❌ Process error: ${error.message}`);
    });

    // Initial timeout to check for immediate input requests
    outputTimer = setTimeout(() => {
      if (!hasReceivedOutput) {
        // For SSH, check immediately if it might be waiting for password
        if (command.includes("ssh")) {
          sessionManager.setWaitingForInput(sessionId, true);
          const message = `🔐 **SSH Connection:** \`${command}\`\n\n💭 SSH may be waiting for password. Please send your password now.\n\n⚡ Commands:\n• \`exit\` - End session`;
          sendWhatsappMessage(c, phone, message);
          resolve("🔐 SSH connection started. Please provide your password.");
        } else {
          checkForInputRequest(sessionId, phone, c, output, resolve);
        }
      }
    }, 500);
  });
}

function checkForInputRequest(
  sessionId: string,
  phone: string,
  c: Context,
  output: string,
  resolve: (value: string) => void,
): void {
  const session = sessionManager.getSession(phone);
  if (!session || !session.process) {
    resolve(`❌ Session lost`);
    return;
  }

  // Check if output indicates waiting for input
  const lowerOutput = output.toLowerCase();
  const inputIndicators = [
    "password:",
    "password for",
    "enter password:",
    "passphrase:",
    "'s password:",
    "password:",
    "continue?",
    "yes/no",
    "y/n",
    "[y/n]",
    "(y/n)",
    "do you want to continue",
    "do you want to install",
    "proceed with",
    "are you sure",
    "confirm",
    "press any key",
    "enter",
    "input:",
    "please enter",
    "waiting for input",
    "install these packages",
    "continue with this action",
    "abort the installation",
    "would you like to",
    "type 'yes' to continue",
    "do you want to",
    "shall i",
    "ok to continue",
    "continue?",
    "proceed?",
    "install?",
    "upgrade?",
    "remove?",
    "delete?",
    "overwrite?",
    "login:",
    "username:",
  ];

  const needsInput = inputIndicators.some((indicator) =>
    lowerOutput.includes(indicator),
  );

  if (
    needsInput ||
    output.trim().endsWith(":") ||
    output.trim().endsWith("?") ||
    output.trim().endsWith("(Y/n)") ||
    output.trim().endsWith("(y/N)") ||
    output.trim().endsWith("[Y/n]") ||
    output.trim().endsWith("[y/N]") ||
    output.trim().endsWith("(yes/no)") ||
    output.trim().endsWith("[yes/no]") ||
    /\b(continue|proceed|install|upgrade|remove)\?\s*$/i.test(output.trim())
  ) {
    sessionManager.setWaitingForInput(sessionId, true);

    // Send current output and ask for input
    const message = `🖥️ **Interactive Command Output:**\n\`\`\`\n${output}\n\`\`\`\n\n💬 **Waiting for input.** Please send your response.\n\n⚡ Commands:\n• \`exit\` - End session\n• \`sessions\` - Show session info`;

    sendWhatsappMessage(c, phone, message);
    resolve(
      "🔄 Command is running interactively. Please provide input when requested.",
    );
  } else if (output.trim()) {
    // Command produced output but doesn't seem to need input
    // Wait a bit more to be sure
    setTimeout(() => {
      if (session.process && !session.process.killed) {
        sessionManager.setWaitingForInput(sessionId, true);
        const message = `🖥️ **Command Output:**\n\`\`\`\n${output}\n\`\`\`\n\n💭 Command may be waiting for input. Send your response or type \`exit\` to end.`;
        sendWhatsappMessage(c, phone, message);
      }
      resolve("🔄 Command is running. Output sent separately.");
    }, 1500);
  } else {
    // No output yet, assume it's waiting for input
    sessionManager.setWaitingForInput(sessionId, true);
    const message = `🔄 **Command started:** \`${session.command}\`\n\n💭 No immediate output. The command may be waiting for input.\nPlease provide input or type \`exit\` to end the session.`;
    sendWhatsappMessage(c, phone, message);
    resolve(
      "🔄 Interactive command started. Please provide input when requested.",
    );
  }
}

async function handleInteractiveInput(
  session: InteractiveSession,
  input: string,
  c: Context,
): Promise<string> {
  if (!session.process || session.process.killed) {
    sessionManager.endSession(session.phone);
    return "❌ Session process is no longer active.";
  }

  // Send input to the process
  try {
    session.process.stdin?.write(input + "\n");
    sessionManager.setWaitingForInput(session.id, false);
    sessionManager.updateSessionActivity(session.id);

    // Set up output collection
    return new Promise((resolve) => {
      let output = "";
      let outputTimer: NodeJS.Timeout;

      const handleOutput = (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;

        // Reset timer on new output
        clearTimeout(outputTimer);
        outputTimer = setTimeout(() => {
          // Check if we need more input
          checkForInputRequest(session.id, session.phone, c, output, resolve);
        }, 1500);
      };

      // Temporarily attach output handlers
      session.process!.stdout?.on("data", handleOutput);
      session.process!.stderr?.on("data", handleOutput);

      // Handle process exit
      session.process!.on("exit", (code) => {
        clearTimeout(outputTimer);
        session.process!.stdout?.removeListener("data", handleOutput);
        session.process!.stderr?.removeListener("data", handleOutput);
        sessionManager.endSession(session.phone);

        if (output.trim()) {
          resolve(
            `✅ Command completed (Exit Code: ${code})\n\n\`\`\`\n${output}\n\`\`\``,
          );
        } else {
          resolve(`✅ Command completed (Exit Code: ${code})`);
        }
      });

      // Initial timeout
      outputTimer = setTimeout(() => {
        checkForInputRequest(session.id, session.phone, c, output, resolve);
      }, 2000);

      // Cleanup timeout after 30 seconds
      setTimeout(() => {
        clearTimeout(outputTimer);
        session.process!.stdout?.removeListener("data", handleOutput);
        session.process!.stderr?.removeListener("data", handleOutput);

        if (output.trim()) {
          resolve(
            `⏰ Input processed. Current output:\n\`\`\`\n${output}\n\`\`\``,
          );
        } else {
          resolve("⏰ Input sent to command. No immediate output.");
        }
      }, 30000);
    });
  } catch (error) {
    sessionManager.endSession(session.phone);
    return `❌ Failed to send input: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}
