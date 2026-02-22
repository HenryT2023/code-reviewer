// Process management: spawn, kill, timeout, log collection
import { spawn, ChildProcess } from 'child_process';
import type { ProcessHandle, StartConfig } from '../types';

export interface SpawnOptions {
  config: StartConfig;
  timeout: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export function spawnProcess(options: SpawnOptions): ProcessHandle {
  const { config, timeout, onStdout, onStderr } = options;

  let stdout = '';
  let stderr = '';
  let killed = false;
  let exitCode: number | null = null;
  let exitResolve: ((code: number) => void) | null = null;

  const env = {
    ...process.env,
    ...config.env,
  };

  const child: ChildProcess = spawn(config.command, config.args, {
    cwd: config.cwd,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const timeoutId = setTimeout(() => {
    if (!killed && child.pid) {
      console.log(`[process] Timeout reached (${timeout}ms), killing process ${child.pid}`);
      killProcess(child);
      killed = true;
    }
  }, timeout);

  child.stdout?.on('data', (data: Buffer) => {
    const str = data.toString();
    stdout += str;
    onStdout?.(str);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const str = data.toString();
    stderr += str;
    onStderr?.(str);
  });

  child.on('exit', (code) => {
    clearTimeout(timeoutId);
    exitCode = code ?? 1;
    exitResolve?.(exitCode);
  });

  child.on('error', (err) => {
    stderr += `\nProcess error: ${err.message}`;
    clearTimeout(timeoutId);
    exitCode = 1;
    exitResolve?.(1);
  });

  return {
    get pid() {
      return child.pid || 0;
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    kill: async () => {
      if (!killed && child.pid) {
        clearTimeout(timeoutId);
        killed = true;
        await killProcess(child);
      }
    },
    waitForExit: () => {
      if (exitCode !== null) {
        return Promise.resolve(exitCode);
      }
      return new Promise<number>((resolve) => {
        exitResolve = resolve;
      });
    },
  };
}

async function killProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid) {
      resolve();
      return;
    }

    // Try graceful shutdown first
    child.kill('SIGTERM');

    const forceKillTimeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Process may already be dead
      }
      resolve();
    }, 5000);

    child.once('exit', () => {
      clearTimeout(forceKillTimeout);
      resolve();
    });
  });
}

export async function waitForPort(port: number, timeout: number, host = '127.0.0.1'): Promise<boolean> {
  const startTime = Date.now();
  const checkInterval = 500;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://${host}:${port}/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok || response.status < 500) {
        return true;
      }
    } catch {
      // Port not ready yet
    }
    await sleep(checkInterval);
  }

  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findAvailablePort(startPort = 3000, maxAttempts = 100): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Unable to find available port starting from ${startPort}`);
}

async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(500),
    });
    // If we get a response, port is in use
    return false;
  } catch {
    // Connection refused = port available
    return true;
  }
}
