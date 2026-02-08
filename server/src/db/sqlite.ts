import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

export interface EvaluationRecord {
  id: string;
  projectName: string;
  projectPath: string;
  context: string;
  overallScore: number | null;
  status: 'pending' | 'analyzing' | 'evaluating' | 'completed' | 'failed';
  analysisData: string | null;
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

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'evaluations.json');

let evaluations: Map<string, EvaluationRecord> = new Map();
let roleEvaluations: Map<string, RoleEvaluationRecord[]> = new Map();

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

loadData();

export function createEvaluation(
  projectName: string,
  projectPath: string,
  context: string
): string {
  const id = uuidv4();
  const record: EvaluationRecord = {
    id,
    projectName,
    projectPath,
    context,
    overallScore: null,
    status: 'pending',
    analysisData: null,
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

export function listEvaluations(limit = 20): EvaluationRecord[] {
  const all = Array.from(evaluations.values());
  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return all.slice(0, limit);
}

export function deleteEvaluation(id: string) {
  evaluations.delete(id);
  roleEvaluations.delete(id);
  saveData();
}
