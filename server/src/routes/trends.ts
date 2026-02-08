import { Router } from 'express';
import { listEvaluations, getRoleEvaluations } from '../db/sqlite';

const router = Router();

router.get('/project/:projectPath', (req, res) => {
  const { projectPath } = req.params;
  const decodedPath = decodeURIComponent(projectPath);
  
  const allEvaluations = listEvaluations(100);
  const projectEvaluations = allEvaluations
    .filter(e => e.projectPath === decodedPath && e.status === 'completed')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const trends = projectEvaluations.map(e => {
    const roleEvals = getRoleEvaluations(e.id);
    return {
      id: e.id,
      date: e.createdAt,
      overallScore: e.overallScore,
      roleScores: roleEvals.reduce((acc, r) => {
        acc[r.role] = r.score;
        return acc;
      }, {} as Record<string, number | null>),
    };
  });

  res.json({
    projectPath: decodedPath,
    evaluationCount: trends.length,
    trends,
    improvement: calculateImprovement(trends),
  });
});

router.get('/compare', (req, res) => {
  const { ids } = req.query;
  
  if (!ids || typeof ids !== 'string') {
    return res.status(400).json({ error: 'ids query parameter required' });
  }

  const idList = ids.split(',');
  const comparisons = idList.map(id => {
    const allEvaluations = listEvaluations(100);
    const evaluation = allEvaluations.find(e => e.id === id);
    if (!evaluation) return null;

    const roleEvals = getRoleEvaluations(id);
    return {
      id: evaluation.id,
      projectName: evaluation.projectName,
      projectPath: evaluation.projectPath,
      date: evaluation.createdAt,
      overallScore: evaluation.overallScore,
      roleScores: roleEvals.reduce((acc, r) => {
        acc[r.role] = {
          score: r.score,
          summary: r.summary,
        };
        return acc;
      }, {} as Record<string, { score: number | null; summary: string | null }>),
    };
  }).filter(Boolean);

  res.json({ comparisons });
});

router.get('/stats', (req, res) => {
  const allEvaluations = listEvaluations(1000);
  const completed = allEvaluations.filter(e => e.status === 'completed');

  const projectStats = new Map<string, { count: number; avgScore: number; scores: number[] }>();
  
  for (const e of completed) {
    const existing = projectStats.get(e.projectPath) || { count: 0, avgScore: 0, scores: [] };
    existing.count++;
    if (e.overallScore !== null) {
      existing.scores.push(e.overallScore);
    }
    projectStats.set(e.projectPath, existing);
  }

  const projects = Array.from(projectStats.entries()).map(([path, stats]) => ({
    projectPath: path,
    evaluationCount: stats.count,
    avgScore: stats.scores.length > 0 
      ? Math.round(stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length) 
      : null,
    latestScore: stats.scores[stats.scores.length - 1] || null,
    trend: calculateTrend(stats.scores),
  }));

  const overallStats = {
    totalEvaluations: allEvaluations.length,
    completedEvaluations: completed.length,
    uniqueProjects: projectStats.size,
    avgScore: completed.length > 0 
      ? Math.round(completed.reduce((sum, e) => sum + (e.overallScore || 0), 0) / completed.length)
      : 0,
  };

  res.json({
    overall: overallStats,
    projects,
  });
});

function calculateImprovement(trends: { overallScore: number | null }[]): {
  hasImproved: boolean;
  delta: number;
  percentage: number;
} | null {
  if (trends.length < 2) return null;

  const first = trends[0].overallScore;
  const last = trends[trends.length - 1].overallScore;

  if (first === null || last === null) return null;

  const delta = last - first;
  const percentage = first > 0 ? Math.round((delta / first) * 100) : 0;

  return {
    hasImproved: delta > 0,
    delta,
    percentage,
  };
}

function calculateTrend(scores: number[]): 'up' | 'down' | 'stable' | null {
  if (scores.length < 2) return null;

  const recent = scores.slice(-3);
  const first = recent[0];
  const last = recent[recent.length - 1];

  if (last > first + 5) return 'up';
  if (last < first - 5) return 'down';
  return 'stable';
}

export default router;
