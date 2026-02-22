// Evolution API: endpoints for viewing reflections, triggering synthesis, and managing evolution
import { Router, Request, Response } from 'express';
import {
  listReflections,
  getReflection,
  getReflectionCount,
  saveSynthesis,
  getLatestSynthesis,
  listSyntheses,
  markSynthesisApplied,
  getEvaluation,
  getRoleEvaluations,
  saveReflection,
  getAllMrepReports,
  getAllMrepVerifications,
} from '../db/sqlite';
import { runEvolutionSynthesis, runReflection } from '../ai/role-evolution';
import type { ReflectionResult, RoleResult } from '../ai/role-evolution';
import { computeAggregateStats } from '../mrep/metrics';
import { applyOverrides, rollbackOverride, listOverrides as listProjectOverrides } from '../prompt-overrides/manager';

const router = Router();

function getProjectFilter(req: Request): string | undefined {
  const p = req.query.project;
  return typeof p === 'string' && p.length > 0 ? decodeURIComponent(p) : undefined;
}

// GET /api/evolution/reflections - List all reflections (optionally filtered by ?project=)
router.get('/reflections', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const reflections = listReflections(50, projectPath);
    res.json({
      count: reflections.length,
      total: getReflectionCount(projectPath),
      projectPath: projectPath || null,
      reflections,
    });
  } catch (error) {
    console.error('List reflections error:', error);
    res.status(500).json({ error: 'Failed to list reflections' });
  }
});

// GET /api/evolution/reflections/:evaluationId - Get reflection for a specific evaluation
router.get('/reflections/:evaluationId', async (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    const reflection = getReflection(evaluationId);
    
    if (!reflection) {
      return res.status(404).json({ error: 'Reflection not found for this evaluation' });
    }
    
    res.json(reflection);
  } catch (error) {
    console.error('Get reflection error:', error);
    res.status(500).json({ error: 'Failed to get reflection' });
  }
});

// POST /api/evolution/synthesize - Trigger evolution synthesis (optionally scoped by ?project=)
router.post('/synthesize', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const reflections = listReflections(20, projectPath);
    
    if (reflections.length === 0) {
      return res.status(400).json({ error: projectPath ? `No reflections for project: ${projectPath}` : 'No reflections available for synthesis' });
    }

    // Convert storage format to AI format
    const reflectionResults: ReflectionResult[] = reflections.map(r => ({
      evaluation_id: r.evaluationId,
      timestamp: r.timestamp,
      role_assessments: r.roleAssessments.map(a => ({
        role: a.role,
        quality_score: a.qualityScore,
        strengths: a.strengths,
        weaknesses: a.weaknesses,
        prompt_suggestions: a.promptSuggestions,
        redundancy_with: a.redundancyWith,
      })),
      blind_spots: r.blindSpots,
      new_role_proposals: r.newRoleProposals.map(p => ({
        id: p.id,
        label: p.label,
        emoji: p.emoji,
        rationale: p.rationale,
        draft_prompt_sketch: p.draftPromptSketch,
      })),
      meta_observations: r.metaObservations,
    }));

    console.log(`Starting evolution synthesis with ${reflections.length} reflections...`);
    const synthesis = await runEvolutionSynthesis(reflectionResults);

    // Save synthesis result
    const synthesisId = saveSynthesis({
      projectPath: projectPath || reflections[0]?.projectPath || '__unknown__',
      version: synthesis.version,
      generatedAt: synthesis.generated_at,
      promptDiffs: synthesis.prompt_diffs.map(d => ({
        role: d.role,
        suggestedAdditions: d.suggested_additions,
        suggestedRemovals: d.suggested_removals,
        rewrittenPrompt: d.rewritten_prompt,
        confidence: d.confidence,
        evidenceCount: d.evidence_count,
      })),
      newRoles: synthesis.new_roles.map(r => ({
        id: r.id,
        label: r.label,
        emoji: r.emoji,
        category: r.category,
        standardPrompt: r.standard_prompt,
        launchReadyPrompt: r.launch_ready_prompt,
        proposalCount: r.proposal_count,
        confidence: r.confidence,
      })),
      retireCandidates: synthesis.retire_candidates.map(c => ({
        role: c.role,
        reason: c.reason,
      })),
    });

    console.log(`Evolution synthesis complete: ${synthesis.prompt_diffs.length} diffs, ${synthesis.new_roles.length} new roles`);

    res.json({
      id: synthesisId,
      reflectionCount: reflections.length,
      ...synthesis,
    });
  } catch (error) {
    console.error('Synthesis error:', error);
    res.status(500).json({ error: 'Failed to run evolution synthesis' });
  }
});

// GET /api/evolution/latest-synthesis - Get the latest synthesis result (optionally filtered by ?project=)
router.get('/latest-synthesis', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const synthesis = getLatestSynthesis(projectPath);
    
    if (!synthesis) {
      return res.status(404).json({ error: 'No synthesis available yet' });
    }
    
    res.json(synthesis);
  } catch (error) {
    console.error('Get latest synthesis error:', error);
    res.status(500).json({ error: 'Failed to get latest synthesis' });
  }
});

// GET /api/evolution/syntheses - List all syntheses (optionally filtered by ?project=)
router.get('/syntheses', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const syntheses = listSyntheses(10, projectPath);
    res.json({
      count: syntheses.length,
      projectPath: projectPath || null,
      syntheses,
    });
  } catch (error) {
    console.error('List syntheses error:', error);
    res.status(500).json({ error: 'Failed to list syntheses' });
  }
});

// POST /api/evolution/apply/:synthesisId - Apply synthesis: write prompt overrides + mark applied
router.post('/apply/:synthesisId', async (req: Request, res: Response) => {
  try {
    const { synthesisId } = req.params;

    // Find the synthesis
    const allSyntheses = listSyntheses(100);
    const synthesis = allSyntheses.find(s => s.id === synthesisId);
    if (!synthesis) {
      return res.status(404).json({ error: 'Synthesis not found' });
    }

    // Write prompt overrides for diffs with rewritten prompts
    const diffs = synthesis.promptDiffs
      .filter(d => d.rewrittenPrompt && d.rewrittenPrompt.trim().length > 0)
      .map(d => ({
        role: d.role,
        rewrittenPrompt: d.rewrittenPrompt,
        confidence: d.confidence,
      }));

    let overrideResult = { applied: [] as string[], skipped: [] as string[] };
    if (diffs.length > 0) {
      overrideResult = applyOverrides(synthesisId, synthesis.projectPath, diffs);
    }

    // Mark synthesis as applied
    const success = markSynthesisApplied(synthesisId);

    res.json({
      success: true,
      message: 'Synthesis applied with prompt overrides',
      overrides: overrideResult,
    });
  } catch (error) {
    console.error('Apply synthesis error:', error);
    res.status(500).json({ error: 'Failed to apply synthesis' });
  }
});

// POST /api/evolution/rollback/:role - Rollback a prompt override for a role
router.post('/rollback/:role', async (req: Request, res: Response) => {
  try {
    const { role } = req.params;
    const projectPath = getProjectFilter(req);
    if (!projectPath) {
      return res.status(400).json({ error: 'project query parameter is required' });
    }

    const success = rollbackOverride(projectPath, role);
    if (!success) {
      return res.status(404).json({ error: 'No override found for this role' });
    }

    res.json({ success: true, message: `Rolled back override for ${role}` });
  } catch (error) {
    console.error('Rollback error:', error);
    res.status(500).json({ error: 'Failed to rollback override' });
  }
});

// GET /api/evolution/overrides - List prompt overrides for a project
router.get('/overrides', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    if (!projectPath) {
      return res.status(400).json({ error: 'project query parameter is required' });
    }

    const overrides = listProjectOverrides(projectPath);
    res.json({ projectPath, overrides });
  } catch (error) {
    console.error('List overrides error:', error);
    res.status(500).json({ error: 'Failed to list overrides' });
  }
});

// POST /api/evolution/rerun-reflection/:evaluationId - Rerun reflection for a completed evaluation
router.post('/rerun-reflection/:evaluationId', async (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    
    // Check if evaluation exists and is completed
    const evaluation = getEvaluation(evaluationId);
    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    if (evaluation.status !== 'completed') {
      return res.status(400).json({ error: 'Evaluation is not completed yet' });
    }
    
    // Check if reflection already exists
    const existingReflection = getReflection(evaluationId);
    if (existingReflection) {
      return res.status(400).json({ 
        error: 'Reflection already exists for this evaluation',
        reflectionId: existingReflection.id,
      });
    }
    
    // Get role evaluations
    const roleEvaluations = getRoleEvaluations(evaluationId);
    const regularRoles = roleEvaluations.filter(re => !re.role.startsWith('_'));
    
    if (regularRoles.length === 0) {
      return res.status(400).json({ error: 'No role evaluations found for this evaluation' });
    }
    
    // Convert to RoleResult format
    const roleResults: RoleResult[] = regularRoles.map(re => ({
      role: re.role,
      score: re.score || 0,
      summary: re.summary || '',
      details: re.details ? JSON.parse(re.details) : {},
    }));
    
    // Get debate summary if exists
    const debateRole = roleEvaluations.find(re => re.role === '_debate');
    const debateSummary = debateRole?.summary || undefined;
    
    console.log(`[${evaluationId}] Rerunning reflection for ${roleResults.length} roles...`);
    
    // Run reflection
    const reflection = await runReflection(evaluationId, roleResults, debateSummary);
    
    // Save reflection
    const reflectionId = saveReflection({
      evaluationId,
      projectPath: evaluation.projectPath,
      timestamp: reflection.timestamp,
      roleAssessments: reflection.role_assessments.map(a => ({
        role: a.role,
        qualityScore: a.quality_score,
        strengths: a.strengths,
        weaknesses: a.weaknesses,
        promptSuggestions: a.prompt_suggestions,
        redundancyWith: a.redundancy_with,
      })),
      blindSpots: reflection.blind_spots,
      newRoleProposals: reflection.new_role_proposals.map(p => ({
        id: p.id,
        label: p.label,
        emoji: p.emoji,
        rationale: p.rationale,
        draftPromptSketch: p.draft_prompt_sketch,
      })),
      metaObservations: reflection.meta_observations,
    });
    
    console.log(`[${evaluationId}] Reflection rerun complete: ${reflection.role_assessments.length} assessments`);
    
    res.json({
      success: true,
      reflectionId,
      evaluationId,
      roleCount: roleResults.length,
      assessmentCount: reflection.role_assessments.length,
      blindSpotCount: reflection.blind_spots.length,
      newRoleProposalCount: reflection.new_role_proposals.length,
    });
  } catch (error) {
    console.error('Rerun reflection error:', error);
    res.status(500).json({ error: 'Failed to rerun reflection' });
  }
});

// GET /api/evolution/stats - Get evolution statistics (optionally filtered by ?project=)
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const reflections = listReflections(100, projectPath);
    const syntheses = listSyntheses(10, projectPath);
    
    // Calculate average quality scores per role
    const roleScores: Record<string, number[]> = {};
    reflections.forEach(r => {
      r.roleAssessments.forEach(a => {
        if (!roleScores[a.role]) roleScores[a.role] = [];
        roleScores[a.role].push(a.qualityScore);
      });
    });
    
    const averageScores: Record<string, number> = {};
    for (const [role, scores] of Object.entries(roleScores)) {
      averageScores[role] = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
    
    // Count blind spots
    const blindSpotCounts: Record<string, number> = {};
    reflections.forEach(r => {
      r.blindSpots.forEach(spot => {
        blindSpotCounts[spot] = (blindSpotCounts[spot] || 0) + 1;
      });
    });
    
    // Count new role proposals
    const proposalCounts: Record<string, number> = {};
    reflections.forEach(r => {
      r.newRoleProposals.forEach(p => {
        proposalCounts[p.id] = (proposalCounts[p.id] || 0) + 1;
      });
    });
    
    // Compute MREP aggregate stats (scoped by project if filtered)
    let mrepStats = null;
    try {
      const allReports = getAllMrepReports(projectPath);
      const allVerifications = getAllMrepVerifications(projectPath);
      if (allReports.length > 0) {
        mrepStats = computeAggregateStats(allReports, allVerifications);
      }
    } catch (mrepErr) {
      console.error('Failed to compute MREP stats:', mrepErr);
    }

    res.json({
      reflectionCount: reflections.length,
      synthesisCount: syntheses.length,
      averageRoleQuality: averageScores,
      topBlindSpots: Object.entries(blindSpotCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([spot, count]) => ({ spot, count })),
      topNewRoleProposals: Object.entries(proposalCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => ({ id, count })),
      needsSynthesis: reflections.length >= 5 && (syntheses.length === 0 || 
        new Date(reflections[0].timestamp) > new Date(syntheses[0]?.generatedAt || 0)),
      projectPath: projectPath || null,
      mrep: mrepStats,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get evolution stats' });
  }
});

export default router;
