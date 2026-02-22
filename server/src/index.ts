import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createServer } from 'http';

dotenv.config({ path: path.join(process.cwd(), '../.env') });
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config();

import evaluateRouter from './routes/evaluate';
import historyRouter from './routes/history';
import modelsRouter from './routes/models';
import exportRouter from './routes/export';
import trendsRouter from './routes/trends';
import evolutionRouter from './routes/evolution';
import queueRouter from './routes/queue';
import mrepRouter from './routes/mrep';
import judgeRouter from './routes/judge';
import abTestRouter from './routes/ab-test';
import feedbackRouter from './routes/feedback';
import { initWebSocket } from './ws/progress';
import { loadQueueState, startAutoSave, startScheduler, setJobExecutor } from './queue';
import { runEvaluationJob } from './routes/evaluate';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 9000;

app.use(cors());
app.use(express.json());

app.use('/api/evaluate', evaluateRouter);
app.use('/api/history', historyRouter);
app.use('/api/models', modelsRouter);
app.use('/api/export', exportRouter);
app.use('/api/trends', trendsRouter);
app.use('/api/evolution', evolutionRouter);
app.use('/api/queue', queueRouter);
app.use('/api/mrep', mrepRouter);
app.use('/api/judge', judgeRouter);
app.use('/api/ab-test', abTestRouter);
app.use('/api/feedback', feedbackRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

initWebSocket(server);

// Initialize queue system
loadQueueState();
startAutoSave();
setJobExecutor(runEvaluationJob);
startScheduler();

server.listen(PORT, () => {
  console.log(`🚀 CodeReviewer server running on http://localhost:${PORT}`);
  console.log(`📊 API endpoints:`);
  console.log(`   POST /api/evaluate - Start evaluation`);
  console.log(`   GET  /api/evaluate/:id - Get evaluation result`);
  console.log(`   GET  /api/history - List evaluations`);
  console.log(`   GET  /api/health - Health check`);
  console.log(`   GET  /api/queue/status - Queue status`);
  console.log(`   WS   /ws - WebSocket for real-time progress`);
});
