// Prompt Override Manager: per-project prompt overlay system
// Allows evolution synthesis results to be applied as prompt overrides without modifying roles.ts

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const OVERRIDES_DIR = path.join(process.cwd(), 'data', 'prompt-overrides');

export interface OverrideEntry {
  prompt: string;
  sourceSynthesisId: string;
  appliedAt: string;
  version: number;
}

export interface OverrideHistoryEntry {
  role: string;
  version: number;
  prompt: string;
  replacedAt: string;
  sourceSynthesisId: string;
}

interface OverrideFile {
  projectPath: string;
  overrides: Record<string, OverrideEntry>;
  history: OverrideHistoryEntry[];
}

// ─── Helpers ────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(OVERRIDES_DIR)) {
    fs.mkdirSync(OVERRIDES_DIR, { recursive: true });
  }
}

function hashPath(projectPath: string): string {
  return crypto.createHash('md5').update(projectPath).digest('hex');
}

function getFilePath(projectPath: string): string {
  return path.join(OVERRIDES_DIR, `${hashPath(projectPath)}.json`);
}

function loadFile(projectPath: string): OverrideFile {
  const filePath = getFilePath(projectPath);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      console.error(`Failed to parse override file for ${projectPath}`);
    }
  }
  return { projectPath, overrides: {}, history: [] };
}

function saveFile(data: OverrideFile): void {
  ensureDir();
  const filePath = getFilePath(data.projectPath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Public API ─────────────────────────────────────────────────────

export function getOverride(projectPath: string, roleId: string): string | null {
  const data = loadFile(projectPath);
  return data.overrides[roleId]?.prompt || null;
}

export function applyOverrides(
  synthesisId: string,
  projectPath: string,
  promptDiffs: Array<{ role: string; rewrittenPrompt: string; confidence: number }>
): { applied: string[]; skipped: string[] } {
  const data = loadFile(projectPath);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const diff of promptDiffs) {
    if (!diff.rewrittenPrompt || diff.rewrittenPrompt.trim().length < 50) {
      skipped.push(diff.role);
      continue;
    }

    // Archive current override to history if exists
    const existing = data.overrides[diff.role];
    if (existing) {
      data.history.push({
        role: diff.role,
        version: existing.version,
        prompt: existing.prompt,
        replacedAt: new Date().toISOString(),
        sourceSynthesisId: existing.sourceSynthesisId,
      });
    }

    // Write new override
    data.overrides[diff.role] = {
      prompt: diff.rewrittenPrompt,
      sourceSynthesisId: synthesisId,
      appliedAt: new Date().toISOString(),
      version: (existing?.version || 0) + 1,
    };

    applied.push(diff.role);
  }

  saveFile(data);
  console.log(`📝 Applied prompt overrides for ${projectPath}: ${applied.join(', ')} (skipped: ${skipped.join(', ') || 'none'})`);
  return { applied, skipped };
}

export function rollbackOverride(projectPath: string, roleId: string): boolean {
  const data = loadFile(projectPath);

  if (!data.overrides[roleId]) {
    return false;
  }

  // Find the most recent history entry for this role
  const historyIdx = data.history
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.role === roleId)
    .sort((a, b) => new Date(b.h.replacedAt).getTime() - new Date(a.h.replacedAt).getTime())[0];

  if (historyIdx) {
    // Restore from history
    data.overrides[roleId] = {
      prompt: historyIdx.h.prompt,
      sourceSynthesisId: historyIdx.h.sourceSynthesisId,
      appliedAt: new Date().toISOString(),
      version: historyIdx.h.version,
    };
    // Remove the used history entry
    data.history.splice(historyIdx.i, 1);
  } else {
    // No history — just remove the override (fall back to default)
    delete data.overrides[roleId];
  }

  saveFile(data);
  console.log(`⏪ Rolled back prompt override for ${roleId} in ${projectPath}`);
  return true;
}

export function listOverrides(projectPath: string): Array<{
  role: string;
  version: number;
  appliedAt: string;
  sourceSynthesisId: string;
  promptPreview: string;
}> {
  const data = loadFile(projectPath);
  return Object.entries(data.overrides).map(([role, entry]) => ({
    role,
    version: entry.version,
    appliedAt: entry.appliedAt,
    sourceSynthesisId: entry.sourceSynthesisId,
    promptPreview: entry.prompt.slice(0, 200) + (entry.prompt.length > 200 ? '...' : ''),
  }));
}

export function getOverrideHistory(projectPath: string, roleId: string): OverrideHistoryEntry[] {
  const data = loadFile(projectPath);
  return data.history
    .filter(h => h.role === roleId)
    .sort((a, b) => new Date(b.replacedAt).getTime() - new Date(a.replacedAt).getTime());
}

export function clearOverrides(projectPath: string): void {
  const filePath = getFilePath(projectPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`🗑️ Cleared all prompt overrides for ${projectPath}`);
  }
}
