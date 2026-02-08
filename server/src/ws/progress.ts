import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface ProgressEvent {
  evaluationId: string;
  type: 'started' | 'analyzing' | 'evaluating_role' | 'role_completed' | 'completed' | 'failed';
  message: string;
  progress: number;
  data?: Record<string, unknown>;
}

const clients = new Map<string, Set<WebSocket>>();

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'subscribe' && data.evaluationId) {
          subscribeToEvaluation(ws, data.evaluationId);
        }
        if (data.type === 'unsubscribe' && data.evaluationId) {
          unsubscribeFromEvaluation(ws, data.evaluationId);
        }
      } catch {
        // ignore invalid messages
      }
    });

    ws.on('close', () => {
      for (const [, sockets] of clients) {
        sockets.delete(ws);
      }
    });
  });

  console.log('📡 WebSocket server initialized on /ws');
}

function subscribeToEvaluation(ws: WebSocket, evaluationId: string) {
  if (!clients.has(evaluationId)) {
    clients.set(evaluationId, new Set());
  }
  clients.get(evaluationId)!.add(ws);
}

function unsubscribeFromEvaluation(ws: WebSocket, evaluationId: string) {
  clients.get(evaluationId)?.delete(ws);
}

export function emitProgress(event: ProgressEvent) {
  const sockets = clients.get(event.evaluationId);
  if (!sockets) return;

  const message = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

export function emitStarted(evaluationId: string, projectName: string) {
  emitProgress({
    evaluationId,
    type: 'started',
    message: `开始评测项目: ${projectName}`,
    progress: 0,
    data: { projectName },
  });
}

export function emitAnalyzing(evaluationId: string) {
  emitProgress({
    evaluationId,
    type: 'analyzing',
    message: '正在分析代码结构...',
    progress: 10,
  });
}

export function emitEvaluatingRole(evaluationId: string, role: string, roleIndex: number, totalRoles: number) {
  const roleNames: Record<string, string> = {
    boss: '老板视角',
    merchant: '商户视角',
    operator: '运营视角',
  };
  const progress = 20 + (roleIndex / totalRoles) * 60;
  emitProgress({
    evaluationId,
    type: 'evaluating_role',
    message: `正在进行 ${roleNames[role] || role} 评测...`,
    progress: Math.round(progress),
    data: { role, roleIndex, totalRoles },
  });
}

export function emitRoleCompleted(evaluationId: string, role: string, score: number) {
  const roleNames: Record<string, string> = {
    boss: '老板视角',
    merchant: '商户视角',
    operator: '运营视角',
  };
  emitProgress({
    evaluationId,
    type: 'role_completed',
    message: `${roleNames[role] || role} 评测完成: ${score}分`,
    progress: 80,
    data: { role, score },
  });
}

export function emitCompleted(evaluationId: string, overallScore: number) {
  emitProgress({
    evaluationId,
    type: 'completed',
    message: `评测完成! 总评分: ${overallScore}分`,
    progress: 100,
    data: { overallScore },
  });
}

export function emitFailed(evaluationId: string, error: string) {
  emitProgress({
    evaluationId,
    type: 'failed',
    message: `评测失败: ${error}`,
    progress: 0,
    data: { error },
  });
}
