import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export interface ProgressEvent {
  evaluationId: string;
  type: 'started' | 'analyzing' | 'evaluating_role' | 'role_completed' | 'debating' | 'orchestrating' | 'reflecting' | 'completed' | 'failed';
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

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  boss: '老板视角',
  merchant: '商户视角',
  operator: '运营视角',
  architect: '架构师视角',
  growth: '增长/分发',
  skeptic: '质疑者/红队',
  pricing: '定价策略',
  data_metrics: '数据与指标',
  delivery: '交付经理',
  artist: '体验设计',
  _debate: '对喷辩论',
  _orchestrator: '总控合成',
};

export function emitEvaluatingRole(evaluationId: string, role: string, roleIndex: number, totalRoles: number) {
  const progress = 20 + (roleIndex / totalRoles) * 60;
  emitProgress({
    evaluationId,
    type: 'evaluating_role',
    message: `正在进行 ${ROLE_DISPLAY_NAMES[role] || role} 评测...`,
    progress: Math.round(progress),
    data: { role, roleIndex, totalRoles },
  });
}

export function emitRoleCompleted(evaluationId: string, role: string, score: number) {
  emitProgress({
    evaluationId,
    type: 'role_completed',
    message: `${ROLE_DISPLAY_NAMES[role] || role} 评测完成: ${score}分`,
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

export function emitDebating(evaluationId: string) {
  emitProgress({
    evaluationId,
    type: 'debating',
    message: '🔴 专家对喷辩论中...',
    progress: 82,
  });
}

export function emitOrchestrating(evaluationId: string) {
  emitProgress({
    evaluationId,
    type: 'orchestrating',
    message: '🎯 总控合成 Launch-Ready 报告...',
    progress: 90,
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

export function emitReflecting(evaluationId: string) {
  emitProgress({
    evaluationId,
    type: 'reflecting',
    message: '🧬 角色自进化反思中...',
    progress: 95,
  });
}
