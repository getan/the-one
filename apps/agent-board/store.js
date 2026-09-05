import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function createStore(dataDir) {
  const sessionsFile = join(dataDir, 'sessions.json');
  const runsFile = join(dataDir, 'runs.json');
  const logsDir = join(dataDir, 'logs');
  let sessions = {};
  let runs = {};

  async function load() {
    await mkdir(logsDir, { recursive: true });
    if (existsSync(sessionsFile)) {
      sessions = JSON.parse(await readFile(sessionsFile, 'utf8'));
    }
    if (existsSync(runsFile)) {
      runs = JSON.parse(await readFile(runsFile, 'utf8'));
    }
  }

  async function persist() {
    await writeFile(sessionsFile, JSON.stringify(sessions, null, 2));
    await writeFile(runsFile, JSON.stringify(runs, null, 2));
  }

  function logPath(sessionId) {
    return join(logsDir, sessionId + '.log');
  }

  return {
    load,
    persist,
    logPath,
    getSession(sessionId) {
      return sessions[sessionId] || null;
    },
    listSessions() {
      return Object.values(sessions).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    putSession(session) {
      sessions[session.id] = session;
    },
    getRun(runId) {
      return runs[runId] || null;
    },
    listRuns() {
      return Object.values(runs).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    putRun(run) {
      runs[run.id] = run;
    }
  };
}
