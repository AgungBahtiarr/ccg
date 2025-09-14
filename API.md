# CCG API Documentation

## Overview

The Chat Command Gateway (CCG) provides a webhook API for receiving WhatsApp messages and executing shell commands interactively.

## Base URL

```
http://localhost:3000
```

## Authentication

All commands are authenticated via WhatsApp phone number verification against the `AUTHORIZED_NUMBER` environment variable.

## Endpoints

### POST /webhook

Receives webhook payloads from the Gowa WhatsApp API service.

#### Request Headers

```
Content-Type: application/json
```

#### Request Body

```json
{
  "sender_id": "1234567890123@c.us",
  "message": {
    "text": "!ls -la"
  },
  "pushname": "User Name"
}
```

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| sender_id | string | Yes | WhatsApp sender ID in format `number@c.us` |
| message.text | string | Yes | The message content |
| pushname | string | No | Display name of the sender |

#### Response Codes

| Code | Status | Description |
|------|--------|-------------|
| 200 | OK | Command processed successfully |
| 400 | Bad Request | Invalid JSON payload or missing required fields |
| 403 | Forbidden | Unauthorized phone number |
| 500 | Internal Server Error | Server configuration error |

#### Response Body

```json
{
  "status": "ok",
  "message": "Command processed"
}
```

### GET /

Health check endpoint.

#### Response

```
Bot is running!
```

## Command Format

Commands must start with `!` followed by the shell command:

```
!ls -la
!pwd
!sudo apt update
```

## Interactive Commands

The following commands are detected as interactive and will create persistent sessions:

- `sudo` - Commands requiring elevated privileges
- `ssh` - SSH connections
- `scp` - Secure copy operations
- `mysql` - MySQL database client
- `psql` - PostgreSQL database client
- `passwd` - Password change utility
- `su` - Switch user
- `ftp` - FTP client
- `sftp` - SFTP client
- `telnet` - Telnet client
- `ping` - Network ping utility

## Special Commands

| Command | Description |
|---------|-------------|
| `!exit` | End current interactive session |
| `!quit` | End current interactive session |
| `!sessions` | Show active session information |

## Security

### Blocked Commands

The following commands are blocked for security reasons:

- `rm` - Remove files/directories
- `mv` - Move files/directories
- `shutdown` - System shutdown
- `reboot` - System reboot
- `halt` - System halt
- `chmod` - Change file permissions
- `chown` - Change file ownership
- `del` - Delete command (Windows)
- `dd` - Data duplicator
- `mkfs` - Make filesystem
- `fdisk` - Disk partitioning
- `parted` - Partition management

### Authorization

Only the phone number specified in `AUTHORIZED_NUMBER` environment variable can execute commands.

## Session Management

### Session Lifecycle

1. **Creation**: Interactive commands automatically create a session
2. **Activity**: Sessions are kept alive with each interaction
3. **Timeout**: Sessions expire after 5 minutes of inactivity
4. **Cleanup**: Expired sessions are automatically cleaned up

### Session States

- **Active**: Command is running and ready for input
- **Waiting**: Command is waiting for user input
- **Expired**: Session has timed out and will be cleaned up

## Response Messages

### Success Messages

- `✅ Command completed (Exit Code: 0)`
- `✅ Command executed successfully, but produced no output.`
- `✅ Session ended.`

### Interactive Messages

- `🔄 Command is running interactively. Please provide input when requested.`
- `💬 Waiting for input. Please send your response.`
- `🖥️ Interactive Command Output:`

### Error Messages

- `❌ Error: Command contains a blocked term.`
- `❌ Execution failed:`
- `❌ Session lost`
- `❌ Failed to send input:`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| GOWA_API_URL | Yes | Base URL of the Gowa WhatsApp API |
| AUTHORIZED_NUMBER | Yes | WhatsApp number authorized to use the service |
| WA_USERNAME | Yes | Username for Gowa API authentication |
| WA_PASSWORD | Yes | Password for Gowa API authentication |

## Error Handling

### Client Errors (4xx)

- **400 Bad Request**: Malformed JSON or missing required fields
- **403 Forbidden**: Unauthorized phone number attempting to use service

### Server Errors (5xx)

- **500 Internal Server Error**: Missing environment variables or server configuration issues

## Rate Limiting

Currently, no rate limiting is implemented. Consider implementing rate limiting in production environments.

## Logging

The application logs the following events:

- Incoming webhook payloads
- Command execution attempts
- Interactive session creation/destruction
- Security violations (blocked commands, unauthorized access)
- API communication with Gowa service

## Integration Examples

### Basic Command Execution

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "sender_id": "1234567890123@c.us",
    "message": {
      "text": "!uptime"
    },
    "pushname": "Admin"
  }'
```

### Interactive Command

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "sender_id": "1234567890123@c.us",
    "message": {
      "text": "!ssh user@server.com"
    },
    "pushname": "Admin"
  }'
```

## Webhooks

### Gowa Integration

CCG is designed to work with the Gowa WhatsApp API service. The webhook endpoint `/webhook` expects payloads in Gowa's format.

### Webhook Security

- Verify the webhook source is from your Gowa instance
- Consider implementing webhook signature verification
- Use HTTPS in production environments

## Deployment Considerations

### Production Setup

1. **Environment Variables**: Ensure all required environment variables are set
2. **Process Management**: Use a process manager like PM2 or systemd
3. **Reverse Proxy**: Use nginx or similar for SSL termination
4. **Monitoring**: Implement health checks and logging
5. **Security**: Restrict network access and use firewalls

### Docker Deployment

A Dockerfile is provided for containerized deployment:

```bash
docker build -t ccg .
docker run -d --name ccg -p 3000:3000 --env-file .env ccg
```

## Troubleshooting

### Common Issues

1. **No Response**: Check if AUTHORIZED_NUMBER matches sender
2. **Command Blocked**: Review security blacklist
3. **Session Stuck**: Use `!exit` command or wait for timeout
4. **API Errors**: Verify Gowa API credentials and URL

### Debug Mode

Enable debug logging by setting log level in your environment or modify console.log statements in the source code.