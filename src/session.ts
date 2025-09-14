import { spawn, ChildProcess } from "child_process";

export interface InteractiveSession {
  id: string;
  phone: string;
  process?: ChildProcess;
  command: string;
  isWaitingForInput: boolean;
  createdAt: Date;
  lastActivity: Date;
}

class SessionManager {
  private sessions: Map<string, InteractiveSession> = new Map();
  private readonly SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Clean up expired sessions every minute
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 1000);
  }

  createSession(phone: string, command: string): string {
    const sessionId = `${phone}_${Date.now()}`;
    const session: InteractiveSession = {
      id: sessionId,
      phone,
      command,
      isWaitingForInput: false,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  getSession(phone: string): InteractiveSession | undefined {
    // Find the most recent active session for this phone
    const userSessions = Array.from(this.sessions.values())
      .filter(s => s.phone === phone)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    return userSessions[0];
  }

  updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  setWaitingForInput(sessionId: string, waiting: boolean): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isWaitingForInput = waiting;
      session.lastActivity = new Date();
    }
  }

  setProcess(sessionId: string, process: ChildProcess): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.process = process;
      session.lastActivity = new Date();
    }
  }

  endSession(phone: string): void {
    const session = this.getSession(phone);
    if (session) {
      if (session.process && !session.process.killed) {
        session.process.kill('SIGTERM');
      }
      this.sessions.delete(session.id);
    }
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity.getTime() > this.SESSION_TIMEOUT) {
        if (session.process && !session.process.killed) {
          session.process.kill('SIGTERM');
        }
        this.sessions.delete(sessionId);
        console.log(`Cleaned up expired session: ${sessionId}`);
      }
    }
  }

  getAllSessions(): InteractiveSession[] {
    return Array.from(this.sessions.values());
  }
}

export const sessionManager = new SessionManager();
