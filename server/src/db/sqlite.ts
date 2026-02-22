import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type { MrepRoleReport, MrepVerificationReport } from '../mrep/types';
import type { ReviewReference, GroundedJudgment, JudgeData } from '../grounded-judge/types';

export interface EvaluationRecord {
  id: string;
  projectName: string;
  projectPath: string;
  context: string;
  overallScore: number | null;
  status: 'pending' | 'analyzing' | 'evaluating' | 'completed' | 'failed';
  evaluationType: 'static' | 'dynamic' | 'ui' | 'full';
  analysisData: string | null;
  runtimeStages: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RoleEvaluationRecord {
  id: string;
  evaluationId: string;
  role: string;
  score: number | null;
  summary: string | null;
  details: string | null;
  createdAt: string;
}

interface DatabaseData {
  evaluations: Record<string, EvaluationRecord>;
  roleEvaluations: Record<string, RoleEvaluationRecord[]>;
}

// Evolution data types
export interface ReflectionRecord {
  id: string;
  evaluationId: string;
  projectPath: string;
  timestamp: string;
  roleAssessments: Array<{
    role: string;
    qualityScore: number;
    strengths: string[];
    weaknesses: string[];
    promptSuggestions: string[];
    redundancyWith: string[];
  }>;
  blindSpots: string[];
  newRoleProposals: Array<{
    id: string;
    label: string;
    emoji: string;
    rationale: string;
    draftPromptSketch: string;
  }>;
  metaObservations: string;
}

export interface SynthesisRecord {
  id: string;
  projectPath: string;
  version: string;
  generatedAt: string;
  promptDiffs: Array<{
    role: string;
    suggestedAdditions: string[];
    suggestedRemovals: string[];
    rewrittenPrompt: string;
    confidence: number;
    evidenceCount: number;
  }>;
  newRoles: Array<{
    id: string;
    label: string;
    emoji: string;
    category: string;
    standardPrompt: string;
    launchReadyPrompt: string;
    proposalCount: number;
    confidence: number;
  }>;
  retireCandidates: Array<{
    role: string;
    reason: string;
  }>;
  appliedAt?: string;
}

interface EvolutionData {
  reflections: ReflectionRecord[];
  syntheses: SynthesisRecord[];
}

interface MrepData {
  reports: Record<string, MrepRoleReport[]>;         // evaluationId -> role reports
  verifications: Record<string, MrepVerificationReport[]>; // evaluationId -> verification reports
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'evaluations.json');
const EVOLUTION_FILE = path.join(DATA_DIR, 'role-evolution.json');
const MREP_FILE = path.join(DATA_DIR, 'mrep.json');
const JUDGE_FILE = path.join(DATA_DIR, 'judge.json');
const ABTEST_FILE = path.join(DATA_DIR, 'ab-tests.json');

let evaluations: Map<string, EvaluationRecord> = new Map();
let roleEvaluations: Map<string, RoleEvaluationRecord[]> = new Map();
let evolutionData: EvolutionData = { reflections: [], syntheses: [] };
let mrepData: MrepData = { reports: {}, verifications: {} };
let judgeData: JudgeData = { references: [], judgments: [] };

export interface ABTestRecord {
  id: string;
  projectPath: string;
  synthesisId: string;
  evaluationA: string;
  evaluationB: string;
  status: 'running_a' | 'running_b' | 'judging' | 'decided';
  result?: {
    judgeScoreA: number;
    judgeScoreB: number;
    judgeDelta: number;
    decision: 'apply' | 'discard' | 'inconclusive';
    reason: string;
  };
  createdAt: string;
  updatedAt: string;
}

let abTests: ABTestRecord[] = [];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data: DatabaseData = JSON.parse(raw);
      evaluations = new Map(Object.entries(data.evaluations || {}));
      roleEvaluations = new Map(Object.entries(data.roleEvaluations || {}));
      console.log(`📂 Loaded ${evaluations.size} evaluations from disk`);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }
}

function saveData() {
  ensureDataDir();
  const data: DatabaseData = {
    evaluations: Object.fromEntries(evaluations),
    roleEvaluations: Object.fromEntries(roleEvaluations),
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadEvolutionData() {
  ensureDataDir();
  if (fs.existsSync(EVOLUTION_FILE)) {
    try {
      const raw = fs.readFileSync(EVOLUTION_FILE, 'utf-8');
      evolutionData = JSON.parse(raw);

      // Backward compat: backfill projectPath for old records
      let migrated = 0;
      for (const r of evolutionData.reflections) {
        if (!r.projectPath) {
          const eval_ = evaluations.get(r.evaluationId);
          r.projectPath = eval_?.projectPath || '__unknown__';
          migrated++;
        }
      }
      for (const s of evolutionData.syntheses) {
        if (!s.projectPath) {
          s.projectPath = '__unknown__';
          migrated++;
        }
      }
      if (migrated > 0) {
        console.log(`🧬 Migrated ${migrated} evolution records with projectPath`);
        saveEvolutionData();
      }

      console.log(`🧬 Loaded ${evolutionData.reflections.length} reflections, ${evolutionData.syntheses.length} syntheses`);
    } catch (err) {
      console.error('Failed to load evolution data:', err);
    }
  }
}

function saveEvolutionData() {
  ensureDataDir();
  fs.writeFileSync(EVOLUTION_FILE, JSON.stringify(evolutionData, null, 2));
}

loadData();
loadEvolutionData();
loadMrepData();
loadJudgeData();
loadABTests();

export function createEvaluation(
  projectName: string,
  projectPath: string,
  context: string,
  evaluationType: EvaluationRecord['evaluationType'] = 'static'
): string {
  const id = uuidv4();
  const record: EvaluationRecord = {
    id,
    projectName,
    projectPath,
    context,
    overallScore: null,
    status: 'pending',
    evaluationType,
    analysisData: null,
    runtimeStages: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  evaluations.set(id, record);
  roleEvaluations.set(id, []);
  saveData();
  return id;
}

export function updateEvaluationStatus(
  id: string,
  status: EvaluationRecord['status'],
  analysisData?: string
) {
  const record = evaluations.get(id);
  if (record) {
    record.status = status;
    if (analysisData) {
      record.analysisData = analysisData;
    }
    saveData();
  }
}

export function completeEvaluation(id: string, overallScore: number) {
  const record = evaluations.get(id);
  if (record) {
    record.status = 'completed';
    record.overallScore = overallScore;
    record.completedAt = new Date().toISOString();
    saveData();
  }
}

export function updateRuntimeStages(id: string, runtimeStages: string) {
  const record = evaluations.get(id);
  if (record) {
    record.runtimeStages = runtimeStages;
    saveData();
  }
}

export function saveRoleEvaluation(
  evaluationId: string,
  role: string,
  score: number,
  summary: string,
  details: string
) {
  const id = uuidv4();
  const record: RoleEvaluationRecord = {
    id,
    evaluationId,
    role,
    score,
    summary,
    details,
    createdAt: new Date().toISOString(),
  };
  const list = roleEvaluations.get(evaluationId) || [];
  list.push(record);
  roleEvaluations.set(evaluationId, list);
  saveData();
}

export function getEvaluation(id: string): EvaluationRecord | null {
  return evaluations.get(id) || null;
}

export function getRoleEvaluations(evaluationId: string): RoleEvaluationRecord[] {
  return roleEvaluations.get(evaluationId) || [];
}

export function listEvaluations(limit = 20, projectPath?: string): EvaluationRecord[] {
  let all = Array.from(evaluations.values());
  if (projectPath) {
    all = all.filter(e => e.projectPath === projectPath);
  }
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return all.slice(0, limit);
}

export function listProjects(): Array<{ projectPath: string; projectName: string; evaluationCount: number; latestAt: string }> {
  const projectMap = new Map<string, { projectName: string; count: number; latestAt: string }>();
  for (const e of evaluations.values()) {
    const existing = projectMap.get(e.projectPath);
    if (!existing) {
      projectMap.set(e.projectPath, { projectName: e.projectName, count: 1, latestAt: e.createdAt });
    } else {
      existing.count++;
      if (new Date(e.createdAt) > new Date(existing.latestAt)) {
        existing.latestAt = e.createdAt;
        existing.projectName = e.projectName;
      }
    }
  }
  return Array.from(projectMap.entries())
    .map(([projectPath, info]) => ({
      projectPath,
      projectName: info.projectName,
      evaluationCount: info.count,
      latestAt: info.latestAt,
    }))
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
}

export function deleteEvaluation(id: string) {
  evaluations.delete(id);
  roleEvaluations.delete(id);
  saveData();
}

// ─── Evolution Data Functions ────────────────────────────────────────

export function saveReflection(reflection: Omit<ReflectionRecord, 'id'>): string {
  const id = uuidv4();
  const record: ReflectionRecord = { id, ...reflection };
  evolutionData.reflections.push(record);
  saveEvolutionData();
  return id;
}

export function getReflection(evaluationId: string): ReflectionRecord | null {
  return evolutionData.reflections.find(r => r.evaluationId === evaluationId) || null;
}

export function listReflections(limit = 50, projectPath?: string): ReflectionRecord[] {
  let list = evolutionData.reflections.slice();
  if (projectPath) {
    list = list.filter(r => r.projectPath === projectPath);
  }
  return list
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function getReflectionCount(projectPath?: string): number {
  if (projectPath) {
    return evolutionData.reflections.filter(r => r.projectPath === projectPath).length;
  }
  return evolutionData.reflections.length;
}

export function saveSynthesis(synthesis: Omit<SynthesisRecord, 'id'>): string {
  const id = uuidv4();
  const record: SynthesisRecord = { id, ...synthesis };
  evolutionData.syntheses.push(record);
  saveEvolutionData();
  return id;
}

export function getLatestSynthesis(projectPath?: string): SynthesisRecord | null {
  let list = evolutionData.syntheses.slice();
  if (projectPath) {
    list = list.filter(s => s.projectPath === projectPath);
  }
  if (list.length === 0) return null;
  return list.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
}

export function listSyntheses(limit = 10, projectPath?: string): SynthesisRecord[] {
  let list = evolutionData.syntheses.slice();
  if (projectPath) {
    list = list.filter(s => s.projectPath === projectPath);
  }
  return list
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, limit);
}

export function markSynthesisApplied(synthesisId: string): boolean {
  const synthesis = evolutionData.syntheses.find(s => s.id === synthesisId);
  if (synthesis) {
    synthesis.appliedAt = new Date().toISOString();
    saveEvolutionData();
    return true;
  }
  return false;
}

// ─── MREP Data Functions ────────────────────────────────────────────

function loadMrepData() {
  ensureDataDir();
  if (fs.existsSync(MREP_FILE)) {
    try {
      const raw = fs.readFileSync(MREP_FILE, 'utf-8');
      mrepData = JSON.parse(raw);
      const reportCount = Object.values(mrepData.reports).reduce((sum, arr) => sum + arr.length, 0);
      const verifyCount = Object.values(mrepData.verifications).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`🔍 Loaded ${reportCount} MREP reports, ${verifyCount} verifications`);
    } catch (err) {
      console.error('Failed to load MREP data:', err);
    }
  }
}

function saveMrepData() {
  ensureDataDir();
  fs.writeFileSync(MREP_FILE, JSON.stringify(mrepData, null, 2));
}

export function saveMrepReport(report: MrepRoleReport): void {
  const evalId = report.evaluation_id;
  if (!mrepData.reports[evalId]) {
    mrepData.reports[evalId] = [];
  }
  // Replace existing report for same role, or add new
  const idx = mrepData.reports[evalId].findIndex(r => r.role_id === report.role_id);
  if (idx >= 0) {
    mrepData.reports[evalId][idx] = report;
  } else {
    mrepData.reports[evalId].push(report);
  }
  saveMrepData();
}

export function getMrepReports(evaluationId: string): MrepRoleReport[] {
  return mrepData.reports[evaluationId] || [];
}

export function getAllMrepReports(projectPath?: string): Array<{ evaluationId: string; timestamp: string; roleReports: MrepRoleReport[] }> {
  let entries = Object.entries(mrepData.reports);
  if (projectPath) {
    entries = entries.filter(([evalId]) => {
      const eval_ = evaluations.get(evalId);
      return eval_?.projectPath === projectPath;
    });
  }
  return entries.map(([evalId, reports]) => ({
    evaluationId: evalId,
    timestamp: reports[0]?.timestamp || '',
    roleReports: reports,
  }));
}

export function saveMrepVerification(verification: MrepVerificationReport): void {
  const evalId = verification.evaluation_id;
  if (!mrepData.verifications[evalId]) {
    mrepData.verifications[evalId] = [];
  }
  const idx = mrepData.verifications[evalId].findIndex(v => v.role_id === verification.role_id);
  if (idx >= 0) {
    mrepData.verifications[evalId][idx] = verification;
  } else {
    mrepData.verifications[evalId].push(verification);
  }
  saveMrepData();
}

export function getMrepVerifications(evaluationId: string): MrepVerificationReport[] {
  return mrepData.verifications[evaluationId] || [];
}

// ─── Judge Data Functions ─────────────────────────────────────────────

function loadJudgeData() {
  ensureDataDir();
  if (fs.existsSync(JUDGE_FILE)) {
    try {
      const raw = fs.readFileSync(JUDGE_FILE, 'utf-8');
      judgeData = JSON.parse(raw);
      console.log(`⚖️ Loaded ${judgeData.judgments.length} judgments, ${judgeData.references.length} references`);
    } catch (err) {
      console.error('Failed to load judge data:', err);
    }
  }
}

function saveJudgeData() {
  ensureDataDir();
  fs.writeFileSync(JUDGE_FILE, JSON.stringify(judgeData, null, 2));
}

export function saveJudgeReference(reference: ReviewReference): void {
  const idx = judgeData.references.findIndex(r => r.id === reference.id);
  if (idx >= 0) {
    judgeData.references[idx] = reference;
  } else {
    judgeData.references.push(reference);
  }
  saveJudgeData();
}

export function getJudgeReference(referenceId: string): ReviewReference | null {
  return judgeData.references.find(r => r.id === referenceId) || null;
}

export function saveJudgment(judgment: GroundedJudgment): void {
  const idx = judgeData.judgments.findIndex(j => j.evaluationId === judgment.evaluationId);
  if (idx >= 0) {
    judgeData.judgments[idx] = judgment;
  } else {
    judgeData.judgments.push(judgment);
  }
  saveJudgeData();
}

export function getJudgment(evaluationId: string): GroundedJudgment | null {
  return judgeData.judgments.find(j => j.evaluationId === evaluationId) || null;
}

export function listJudgments(projectPath?: string, limit = 50): GroundedJudgment[] {
  let list = judgeData.judgments.slice();
  if (projectPath) {
    list = list.filter(j => j.projectPath === projectPath);
  }
  return list
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

// ─── A/B Test Data Functions ─────────────────────────────────────────

function loadABTests() {
  ensureDataDir();
  if (fs.existsSync(ABTEST_FILE)) {
    try {
      const raw = fs.readFileSync(ABTEST_FILE, 'utf-8');
      abTests = JSON.parse(raw);
      console.log(`🔬 Loaded ${abTests.length} A/B tests`);
    } catch (err) {
      console.error('Failed to load A/B test data:', err);
    }
  }
}

function saveABTests() {
  ensureDataDir();
  fs.writeFileSync(ABTEST_FILE, JSON.stringify(abTests, null, 2));
}

export function saveABTest(record: ABTestRecord): void {
  const idx = abTests.findIndex(t => t.id === record.id);
  if (idx >= 0) {
    abTests[idx] = record;
  } else {
    abTests.push(record);
  }
  saveABTests();
}

export function getABTest(id: string): ABTestRecord | null {
  return abTests.find(t => t.id === id) || null;
}

export function updateABTest(id: string, updates: Partial<ABTestRecord>): boolean {
  const idx = abTests.findIndex(t => t.id === id);
  if (idx < 0) return false;
  abTests[idx] = { ...abTests[idx], ...updates, updatedAt: new Date().toISOString() };
  saveABTests();
  return true;
}

export function listABTests(projectPath?: string, limit = 20): ABTestRecord[] {
  let list = abTests.slice();
  if (projectPath) {
    list = list.filter(t => t.projectPath === projectPath);
  }
  return list
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export function getAllMrepVerifications(projectPath?: string): Map<string, MrepVerificationReport[]> {
  let entries = Object.entries(mrepData.verifications);
  if (projectPath) {
    entries = entries.filter(([evalId]) => {
      const eval_ = evaluations.get(evalId);
      return eval_?.projectPath === projectPath;
    });
  }
  return new Map(entries);
}
