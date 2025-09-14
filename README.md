# Chat Command Gateway (CCG) - Interactive Edition

A WhatsApp bot that executes shell commands with **full interactive support**. Now you can run commands that require input like `sudo`, `ssh`, and other interactive programs!

## 🚀 Features

- **Interactive Commands**: Full support for commands that require input (passwords, confirmations, etc.)
- **Session Management**: Persistent sessions for long-running interactive commands
- **Security**: Blacklist-based command filtering to prevent dangerous operations
- **WhatsApp Integration**: Seamless communication through WhatsApp using Gowa API
- **Auto-cleanup**: Automatic session cleanup to prevent resource leaks

## 📋 Prerequisites

- **Bun** runtime installed
- **Gowa** WhatsApp API service
- Authorized WhatsApp number for security

## 🛠️ Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd ccg
bun install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```
GOWA_API_URL=your_gowa_api_url
AUTHORIZED_NUMBER=your_authorized_whatsapp_number
WA_USERNAME=your_gowa_username
WA_PASSWORD=your_gowa_password
```

3. **Run the development server:**
```bash
bun run dev
```

The server will start on `http://localhost:3000`.

## 💬 Usage

### Basic Commands
Send messages to your WhatsApp bot starting with `!`:

```
!ls -la
!pwd
!whoami
!uptime
```

### Interactive Commands
The bot now supports interactive commands that require input:

#### SSH Login
```
!ssh user@hostname
```
The bot will detect when SSH asks for a password and prompt you to provide it.

#### Sudo Commands
```
!sudo apt update
```
When prompted for password, simply send your password as the next message.

#### Database Access
```
!mysql -u root -p
```
The bot will handle password prompts and keep the session active for further SQL commands.

### Session Management

#### View Active Sessions
```
!sessions
```

#### End Current Session
```
!exit
```
or
```
!quit
```

## 🔧 How Interactive Mode Works

1. **Detection**: The bot automatically detects when a command is interactive
2. **Session Creation**: Creates a persistent session for the command
3. **Input Handling**: Monitors command output for input requests (password prompts, confirmations, etc.)
4. **User Interaction**: Prompts you via WhatsApp when input is needed
5. **Input Forwarding**: Sends your response directly to the running command
6. **Session Cleanup**: Automatically cleans up sessions after 5 minutes of inactivity

## 🔒 Security Features

### Blocked Commands
The following commands are blocked for security:
- `rm`, `mv`, `dd` - File operations
- `shutdown`, `reboot`, `halt` - System control
- `chmod`, `chown` - Permission changes
- `mkfs`, `fdisk`, `parted` - Disk operations

### Authorization
Only the configured `AUTHORIZED_NUMBER` can execute commands.

## 📱 Interactive Command Examples

### Example 1: SSH with Password
```
You: !ssh ubuntu@myserver.com
Bot: 🔄 Command is running interactively. Please provide input when requested.

Bot: 🖥️ Interactive Command Output:
```
ubuntu@myserver.com's password:
```

💬 Waiting for input. Please send your response.

You: mypassword123
Bot: ✅ Command completed (Exit Code: 0)
```
Welcome to Ubuntu 20.04.3 LTS
ubuntu@myserver:~$
```
```

### Example 2: Sudo Command
```
You: !sudo systemctl restart nginx
Bot: 🔄 Command is running interactively. Please provide input when requested.

Bot: 🖥️ Interactive Command Output:
```
[sudo] password for user:
```

💬 Waiting for input. Please send your response.

You: mypassword
Bot: ✅ Command completed (Exit Code: 0)
```

### Example 3: MySQL Interactive Session
```
You: !mysql -u root -p
Bot: 🔄 Interactive command started: mysql -u root -p

💭 No immediate output. The command may be waiting for input.

You: rootpassword
Bot: 🖥️ Command Output:
```
Welcome to MySQL monitor. Commands end with ; or \g.
mysql>
```

💭 Command may be waiting for input. Send your response or type `exit` to end.

You: SHOW DATABASES;
Bot: 🖥️ Command Output:
```
+--------------------+
| Database           |
+--------------------+
| information_schema |
| mysql             |
| performance_schema |
+--------------------+
3 rows in set (0.00 sec)
mysql>
```

You: exit
Bot: ✅ Session ended.
```

## 🏗️ Architecture

```
WhatsApp User
     ↓
Gowa API (Webhook)
     ↓
CCG Server
     ↓
Session Manager ← → Interactive Handler
     ↓
Shell Command Execution
```

### Key Components

- **Session Manager**: Handles command sessions and lifecycle
- **Interactive Handler**: Detects and manages commands requiring input
- **Security Filter**: Prevents execution of dangerous commands
- **WhatsApp Bridge**: Handles communication with WhatsApp via Gowa API

## 🐛 Troubleshooting

### Session Issues
- **Stuck Session**: Use `!sessions` to check, then `!exit` to end
- **No Response**: Sessions auto-expire after 5 minutes
- **Multiple Sessions**: Only one session per phone number is allowed

### Command Issues
- **Blocked Command**: Check the security blacklist
- **No Output**: Some commands may run silently - wait or check with `!sessions`
- **Authentication Failed**: Verify your WhatsApp number in `AUTHORIZED_NUMBER`

## 📝 Development

### Adding New Interactive Commands
Edit `INTERACTIVE_COMMANDS` in `src/handler.ts`:

```typescript
const INTERACTIVE_COMMANDS = [
  "sudo",
  "ssh", 
  "your-command-here"
];
```

### Customizing Input Detection
Modify `inputIndicators` in the `checkForInputRequest` function to detect specific prompts.

## 🔄 Changelog

### v2.0 - Interactive Edition
- ✅ Added full interactive command support
- ✅ Session management system
- ✅ Real-time input/output handling
- ✅ Enhanced security with expanded blacklist
- ✅ Automatic session cleanup
- ✅ Improved error handling and user feedback

### v1.0 - Basic Edition
- ✅ Basic command execution
- ✅ WhatsApp integration
- ✅ Security filtering

## 📄 License

This project is open source and available under the MIT License.