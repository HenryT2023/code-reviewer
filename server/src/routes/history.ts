import { Router, Request, Response } from 'express';
import { listEvaluations, listProjects, getEvaluation, getRoleEvaluations, deleteEvaluation } from '../db/sqlite';

const router = Router();

// GET /api/history/projects - List all projects with evaluation counts
router.get('/projects', async (_req: Request, res: Response) => {
  try {
    const projects = listProjects();
    res.json(projects);
  } catch (error) {
    console.error('List projects error:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// GET /api/history?project=&limit= - List evaluations, optionally filtered by project
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const project = req.query.project;
    const projectPath = typeof project === 'string' && project.length > 0 ? decodeURIComponent(project) : undefined;
    const evaluations = listEvaluations(limit, projectPath);
    res.json(evaluations);
  } catch (error) {
    console.error('List evaluations error:', error);
    res.status(500).json({ error: 'Failed to list evaluations' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const evaluation = getEvaluation(id);

    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    const roleEvaluations = getRoleEvaluations(id);

    const result = {
      ...evaluation,
      analysisData: evaluation.analysisData ? JSON.parse(evaluation.analysisData) : null,
      roleEvaluations: roleEvaluations.map(re => ({
        ...re,
        details: re.details ? JSON.parse(re.details) : null,
      })),
    };

    res.json(result);
  } catch (error) {
    console.error('Get evaluation error:', error);
    res.status(500).json({ error: 'Failed to get evaluation' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    deleteEvaluation(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete evaluation error:', error);
    res.status(500).json({ error: 'Failed to delete evaluation' });
  }
});

export default router;
