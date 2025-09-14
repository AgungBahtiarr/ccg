import { spawn } from "child_process";
import { sessionManager, InteractiveSession } from "./session";
import { Context } from "hono";
import { sendWhatsappMessage } from "./whatsapp";

// Function to clean ANSI escape sequences and control characters
function cleanOutput(text: string): string {
  let cleaned = text
    // Remove ANSI escape sequences
    .replace(/\x1b\[[0-9;]*[mGKHF]/g, "")
    // Remove ANSI color codes
    .replace(/\x1b\[[0-9;]*m/g, "")
    // Remove terminal control sequences
    .replace(/\x1b\[\?[0-9]+[hl]/g, "")
    // Remove carriage returns followed by spaces
    .replace(/\r\s+/g, "\r")
    // Remove OSC sequences (like window title changes)
    .replace(/\x1b\][0-9;]*.*?\x07/g, "")
    .replace(/\x1b\][0-9;]*.*?\x1b\\/g, "")
    // Remove bracketed paste mode sequences
    .replace(/\x1b\[\?2004[hl]/g, "");

  // Remove SSH login messages and warnings
  const linesToRemove = [
    /Warning: Permanently added .* to the list of known hosts\./,
    /Linux .* x86_64/,
    /The programs included with the .* system are free software;/,
    /the exact distribution terms .* described in the/,
    /individual files in \/usr\/share\/doc\/\*\/copyright\./,
    /.*GNU\/Linux comes with ABSOLUTELY NO WARRANTY.*/,
    /permitted by applicable law\./,
    /Last login: .* from .*/,
  ];

  const lines = cleaned.split("\n");
  const filteredLines = lines.filter((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return false;
    return !linesToRemove.some((regex) => regex.test(trimmedLine));
  });

  cleaned = filteredLines
    .join("\n")
    // Clean bash prompt artifacts
    .replace(/\][0-9;]*;.*?@.*?:[^$]*\$ /g, "$ ")
    // Remove common bash prompt sequences but keep the last one
    .replace(/.*@.*?:\~?\$ (?!.*@.*?:\~?\$)/g, "$ ")
    .replace(/.*@.*?:[^$]*\$ (?!.*@.*?:[^$]*\$)/g, "$ ")
    // Clean up multiple newlines
    .replace(/\n{3,}/g, "\n\n")
    // Remove trailing whitespace from lines
    .replace(/[ \t]+$/gm, "")
    .trim();

  // If output is mostly SSH login stuff, return empty to avoid spam
  const importantLines = cleaned
    .split("\n")
    .filter(
      (line) =>
        line.trim() && !line.includes("$ ") && !line.match(/.*@.*?:[^$]*\$/),
    );

  if (importantLines.length === 0 && cleaned.includes("$ ")) {
    return "$ "; // Just show prompt
  }

  return cleaned;
}

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

    // Special handling for SSH - force pseudo-terminal allocation
    if (command.trim().startsWith("ssh")) {
      finalCommand = `script -qec "${command} -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15 -o BatchMode=no" /dev/null`;
    }

    const childProcess = spawn("/bin/bash", ["-c", finalCommand], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    sessionManager.setProcess(sessionId, childProcess);

    // Handle stdout
    childProcess.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();

      // Check for SSH login failures first
      if (
        chunk.includes("Permission denied") ||
        chunk.includes("Access denied") ||
        chunk.includes("Authentication failed") ||
        chunk.includes("Connection closed by") ||
        chunk.includes("Host key verification failed") ||
        chunk.includes("Connection refused") ||
        chunk.includes("Connection timed out") ||
        chunk.includes("No route to host")
      ) {
        output += chunk;
        hasReceivedOutput = true;
        // Don't resolve here, let the exit handler deal with it
      }
      // Check for SSH password prompts more aggressively
      else if (
        chunk.toLowerCase().includes("password") ||
        chunk.includes("'s password:") ||
        /password.*:/i.test(chunk)
      ) {
        sessionManager.setWaitingForInput(sessionId, true);
        const cleanedChunk = cleanOutput(output + chunk);
        const message = `🔐 **SSH Password Required**\n\nCommand: \`${command}\`\n\nOutput:\n\`\`\`\n${cleanedChunk}\n\`\`\`\n\n💬 Please send your password now.\n\n⚡ Commands:\n• \`exit\` - End session`;
        if (sessionManager.shouldSendMessage(phone, cleanedChunk)) {
          sendWhatsappMessage(c, phone, message);
          sessionManager.markMessageSent(phone, cleanedChunk);
        }
        resolve("🔐 SSH is asking for password. Please provide it now.");
        return;
      } else {
        output += chunk;
        hasReceivedOutput = true;

        console.log(`Interactive stdout from ${phone}: ${chunk}`);

        // Reset the timer whenever we receive output
        clearTimeout(outputTimer);
        outputTimer = setTimeout(() => {
          checkForInputRequest(sessionId, phone, c, output, resolve);
        }, 500); // Wait 500ms after last output
      }
    });

    // Handle stderr
    childProcess.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();

      // Filter out apt CLI warnings but keep other stderr
      if (
        !chunk.includes("WARNING: apt does not have a stable CLI interface")
      ) {
        // Check for SSH connection issues in stderr
        if (
          chunk.includes("Permission denied") ||
          chunk.includes("Access denied") ||
          chunk.includes("Authentication failed") ||
          chunk.includes("Connection closed") ||
          chunk.includes("Host key verification failed") ||
          chunk.includes("Connection refused") ||
          chunk.includes("Connection timed out") ||
          chunk.includes("No route to host") ||
          chunk.includes("Name or service not known")
        ) {
          output += chunk;
          hasReceivedOutput = true;
          // Don't resolve here, let the exit handler deal with it
        } else {
          output += chunk;
          hasReceivedOutput = true;

          console.log(`Interactive stderr from ${phone}: ${chunk}`);

          // Reset the timer whenever we receive output
          clearTimeout(outputTimer);
          outputTimer = setTimeout(() => {
            checkForInputRequest(sessionId, phone, c, output, resolve);
          }, 800);
        }
      }
    });

    // Handle process exit
    childProcess.on("exit", (code, signal) => {
      clearTimeout(outputTimer);
      sessionManager.endSession(phone);

      const cleanedOutput = cleanOutput(output);

      // Handle SSH specific failures with detailed diagnostics
      if (command.includes("ssh") && (code === 255 || code !== 0)) {
        if (output.includes("Permission denied")) {
          const attempts = (output.match(/Permission denied/g) || []).length;
          resolve(
            `❌ **SSH Authentication Failed**\n\n🔐 **Issue**: Wrong password or username (${attempts} attempts)\n\n💡 **Solutions**:\n- Double-check username: \`${command.split("@")[0].replace("ssh ", "")}\`\n- Verify password is correct\n- Ensure user exists on target system\n- Try: \`!ssh -v ${command.split(" ").slice(1).join(" ")}\` for verbose output\n\n📋 **Details**:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
          );
        } else if (output.includes("Connection refused")) {
          resolve(
            `❌ **SSH Connection Refused**\n\n🔌 **Issue**: SSH service not accessible\n\n💡 **Solutions**:\n- Check if SSH service is running: \`sudo systemctl status ssh\`\n- Verify correct port (default 22): \`!ssh -p 22 ${command.split(" ").slice(1).join(" ")}\`\n- Check firewall settings on target host\n- Ensure host is reachable: \`!ping ${command.split("@")[1] || command.split(" ")[1]}\`\n\n📋 **Details**:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
          );
        } else if (output.includes("Connection timed out")) {
          resolve(
            `❌ **SSH Connection Timeout**\n\n⏰ **Issue**: Host unreachable or network problems\n\n💡 **Solutions**:\n- Check network connectivity: \`!ping ${command.split("@")[1] || command.split(" ")[1]}\`\n- Verify correct hostname/IP address\n- Check if host is powered on\n- Try with longer timeout: \`!ssh -o ConnectTimeout=30 ${command.split(" ").slice(1).join(" ")}\`\n\n📋 **Details**:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
          );
        } else if (output.includes("Host key verification failed")) {
          resolve(
            `❌ **SSH Host Key Verification Failed**\n\n🔑 **Issue**: Host key has changed (potential security risk)\n\n💡 **Solutions**:\n- If you trust the host, remove old key: \`ssh-keygen -R ${command.split("@")[1] || command.split(" ")[1]}\`\n- Or use: \`!ssh -o StrictHostKeyChecking=no ${command.split(" ").slice(1).join(" ")}\`\n- Contact system administrator if unexpected\n\n📋 **Details**:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
          );
        } else if (output.includes("Name or service not known")) {
          resolve(
            `❌ **SSH Hostname Resolution Failed**\n\n🌐 **Issue**: Cannot resolve hostname\n\n💡 **Solutions**:\n- Check hostname spelling: \`${command.split("@")[1] || command.split(" ")[1]}\`\n- Try using IP address instead\n- Check DNS settings: \`!nslookup ${command.split("@")[1] || command.split(" ")[1]}\`\n- Verify network connectivity\n\n📋 **Details**:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
          );
        } else if (output.includes("Connection closed by")) {
          resolve(
            `❌ **SSH Connection Closed by Remote Host**\n\n🚫 **Issue**: Remote host terminated connection\n\n💡 **Possible Causes**:\n- Too many failed login attempts (account locked)\n- IP address banned/blocked\n- SSH service configuration restricts access\n- Server overload or maintenance\n\n💡 **Solutions**:\n- Wait a few minutes and try again\n- Contact system administrator\n- Check if your IP is whitelisted\n\n📋 **Details**:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
          );
        } else {
          resolve(
            `❌ **SSH Failed (Exit Code: ${code})**\n\n⚠️ **Unexpected Error**\n\n💡 **Try**:\n- Run with verbose output: \`!ssh -v ${command.split(" ").slice(1).join(" ")}\`\n- Check command syntax\n- Verify all parameters\n\n📋 **Details**:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
          );
        }
      } else if (!hasReceivedOutput) {
        resolve(`✅ Command completed (Exit Code: ${code})`);
      } else {
        resolve(
          `✅ Command completed (Exit Code: ${code})\n\n\`\`\`\n${cleanedOutput}\n\`\`\``,
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
        // For SSH, assume it needs password if no output yet
        if (command.includes("ssh")) {
          sessionManager.setWaitingForInput(sessionId, true);
          const message = `🔐 **SSH Starting**\n\nCommand: \`${command}\`\n\n💭 SSH may be waiting for password. Please send your password.\n\n⚡ Commands:\n• \`exit\` - End session`;
          if (sessionManager.shouldSendMessage(phone, command)) {
            sendWhatsappMessage(c, phone, message);
            sessionManager.markMessageSent(phone, command);
          }
          resolve("🔐 SSH may need password. Please provide it.");
        } else {
          checkForInputRequest(sessionId, phone, c, output, resolve);
        }
      }
    }, 800);
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

  const cleanedOutput = cleanOutput(output);

  if (
    needsInput ||
    cleanedOutput.trim().endsWith(":") ||
    cleanedOutput.trim().endsWith("?") ||
    cleanedOutput.trim().endsWith("(Y/n)") ||
    cleanedOutput.trim().endsWith("(y/N)") ||
    cleanedOutput.trim().endsWith("[Y/n]") ||
    cleanedOutput.trim().endsWith("[y/N]") ||
    cleanedOutput.trim().endsWith("(yes/no)") ||
    cleanedOutput.trim().endsWith("[yes/no]") ||
    /\b(continue|proceed|install|upgrade|remove)\?\s*$/i.test(
      cleanedOutput.trim(),
    ) ||
    cleanedOutput.includes("$ ") || // Bash prompt detected
    /.*@.*?:\S*\$ ?$/m.test(cleanedOutput) // SSH prompt pattern
  ) {
    sessionManager.setWaitingForInput(sessionId, true);

    // Send current output and ask for input
    let displayOutput = cleanedOutput;

    // For SSH sessions, show only relevant command output
    if (session.command.includes("ssh")) {
      const lines = displayOutput.split("\n");
      const relevantLines = [];
      let foundCommand = false;

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.includes("$ ") && foundCommand) {
          relevantLines.unshift(line);
          break;
        }
        relevantLines.unshift(line);
        if (line && !line.includes("$ ") && !line.match(/.*@.*?:[^$]*\$/)) {
          foundCommand = true;
        }
      }

      displayOutput = relevantLines.join("\n").trim();

      // If display is just a prompt or empty, make it cleaner
      if (
        displayOutput === "$ " ||
        displayOutput.match(/^.*@.*?:[^$]*\$$/) ||
        !displayOutput
      ) {
        displayOutput = "$ Ready for next command";
      }
    }

    const message = `🖥️ **Interactive Command Output:**\n\`\`\`\n${displayOutput}\n\`\`\`\n\n💬 **Waiting for input.** Please send your response.\n\n⚡ Commands:\n• \`exit\` - End session\n• \`sessions\` - Show session info`;

    if (sessionManager.shouldSendMessage(phone, displayOutput)) {
      sendWhatsappMessage(c, phone, message);
      sessionManager.markMessageSent(phone, displayOutput);
    }
    resolve(
      "🔄 Command is running interactively. Please provide input when requested.",
    );
  } else if (cleanedOutput.trim()) {
    // Command produced output but doesn't seem to need input
    // Wait a bit more to be sure
    setTimeout(() => {
      if (session.process && !session.process.killed) {
        sessionManager.setWaitingForInput(sessionId, true);
        const message = `🖥️ **Command Output:**\n\`\`\`\n${cleanedOutput}\n\`\`\`\n\n💭 Command may be waiting for input. Send your response or type \`exit\` to end.`;
        if (sessionManager.shouldSendMessage(phone, cleanedOutput)) {
          sendWhatsappMessage(c, phone, message);
          sessionManager.markMessageSent(phone, cleanedOutput);
        }
      }
      resolve("🔄 Command is running. Output sent separately.");
    }, 1500);
  } else {
    // No output yet, assume it's waiting for input
    sessionManager.setWaitingForInput(sessionId, true);
    let message = `🔄 **Command started:** \`${session.command}\`\n\n💭 No immediate output. The command may be waiting for input.\nPlease provide input or type \`exit\` to end the session.`;

    // Special message for SSH commands
    if (session.command.includes("ssh")) {
      message = `🔄 **SSH Command started:** \`${session.command}\`\n\n💭 SSH may be:\n- Establishing connection\n- Waiting for password\n- Performing host key verification\n\nPlease wait or provide input when prompted.\n\n⚡ Commands:\n• \`exit\` - End session`;
    }

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

        const cleanedOutput = cleanOutput(output);
        if (cleanedOutput.trim()) {
          resolve(
            `✅ Command completed (Exit Code: ${code})\n\n\`\`\`\n${cleanedOutput}\n\`\`\``,
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

        const cleanedOutput = cleanOutput(output);
        if (cleanedOutput.trim()) {
          resolve(
            `⏰ Input processed. Current output:\n\`\`\`\n${cleanedOutput}\n\`\`\``,
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
