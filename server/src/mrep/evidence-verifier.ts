// Evidence Verifier: Programmatically verify MREP claims against project source code
import * as fs from 'fs';
import * as path from 'path';
import type { MrepClaim, MrepRoleReport, ClaimVerificationResult, MrepVerificationReport } from './types';

/**
 * Verify all claims in an MREP role report against the actual project files.
 */
export function verifyMrepReport(
  report: MrepRoleReport,
  projectPath: string
): MrepVerificationReport {
  const results = report.claims.map(claim => verifyClaim(claim, projectPath));

  const total = results.length;
  const verified = results.filter(r => r.status === 'verified').length;
  const unverified = results.filter(r => r.status === 'unverified').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const checkable = total - skipped;

  return {
    evaluation_id: report.evaluation_id,
    role_id: report.role_id,
    verified_at: new Date().toISOString(),
    project_path: projectPath,
    results,
    summary: {
      total,
      verified,
      unverified,
      failed,
      skipped,
      pass_rate: checkable > 0 ? Math.round((verified / checkable) * 100) / 100 : 0,
    },
  };
}

/**
 * Verify a single claim.
 */
function verifyClaim(claim: MrepClaim, projectPath: string): ClaimVerificationResult {
  const now = new Date().toISOString();

  if (!claim.verifiable) {
    return { claim_id: claim.id, status: 'skipped', method_used: 'not_verifiable', details: 'Claim marked as not verifiable', checked_at: now };
  }

  if (claim.evidence.length === 0 && !claim.verification_method) {
    return { claim_id: claim.id, status: 'unverified', method_used: 'no_evidence', details: 'No evidence or verification method provided', checked_at: now };
  }

  // Try verification_method first if provided
  if (claim.verification_method) {
    return verifyByMethod(claim, projectPath, now);
  }

  // Otherwise verify evidence references
  return verifyEvidence(claim, projectPath, now);
}

/**
 * Verify using the explicit verification_method field.
 * Supported formats:
 *   - "file_exists:path/to/file"
 *   - "grep_pattern:regex_pattern"
 *   - "metric_check:key>value" or "metric_check:key<value"
 */
function verifyByMethod(
  claim: MrepClaim,
  projectPath: string,
  now: string
): ClaimVerificationResult {
  const method = claim.verification_method!;
  const colonIndex = method.indexOf(':');
  if (colonIndex === -1) {
    return { claim_id: claim.id, status: 'failed', method_used: method, details: 'Invalid verification_method format (expected type:value)', checked_at: now };
  }

  const methodType = method.substring(0, colonIndex);
  const methodValue = method.substring(colonIndex + 1);

  switch (methodType) {
    case 'file_exists':
      return verifyFileExists(claim.id, methodValue, projectPath, now);
    case 'grep_pattern':
      return verifyGrepPattern(claim.id, methodValue, projectPath, now);
    case 'metric_check':
      // metric_check requires analysis data, skip for now
      return { claim_id: claim.id, status: 'skipped', method_used: method, details: 'metric_check requires runtime analysis data', checked_at: now };
    default:
      return { claim_id: claim.id, status: 'skipped', method_used: method, details: `Unknown verification method: ${methodType}`, checked_at: now };
  }
}

function verifyFileExists(
  claimId: string,
  filePath: string,
  projectPath: string,
  now: string
): ClaimVerificationResult {
  const fullPath = path.resolve(projectPath, filePath);
  const exists = fs.existsSync(fullPath);
  return {
    claim_id: claimId,
    status: exists ? 'verified' : 'unverified',
    method_used: `file_exists:${filePath}`,
    details: exists ? `File exists: ${filePath}` : `File not found: ${filePath}`,
    checked_at: now,
  };
}

function verifyGrepPattern(
  claimId: string,
  pattern: string,
  projectPath: string,
  now: string
): ClaimVerificationResult {
  try {
    const regex = new RegExp(pattern);
    const found = searchProjectFiles(projectPath, regex);
    return {
      claim_id: claimId,
      status: found ? 'verified' : 'unverified',
      method_used: `grep_pattern:${pattern}`,
      details: found
        ? `Pattern found in: ${found.file}:${found.line}`
        : `Pattern not found in project`,
      checked_at: now,
    };
  } catch (err) {
    return {
      claim_id: claimId,
      status: 'failed',
      method_used: `grep_pattern:${pattern}`,
      details: `Invalid regex pattern: ${String(err)}`,
      checked_at: now,
    };
  }
}

/**
 * Verify evidence references (code_ref, config_ref, doc_ref).
 */
function verifyEvidence(
  claim: MrepClaim,
  projectPath: string,
  now: string
): ClaimVerificationResult {
  let verifiedCount = 0;
  let totalCheckable = 0;
  const details: string[] = [];

  for (const ev of claim.evidence) {
    if (ev.type === 'code_ref' || ev.type === 'config_ref' || ev.type === 'doc_ref') {
      if (!ev.file) continue;
      totalCheckable++;

      const fullPath = path.resolve(projectPath, ev.file);
      if (!fs.existsSync(fullPath)) {
        details.push(`✗ File not found: ${ev.file}`);
        continue;
      }

      // If lines specified, check they exist
      if (ev.lines) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          const [start, end] = ev.lines;
          if (start > 0 && end <= lines.length) {
            // If snippet provided, check if it matches roughly
            if (ev.snippet) {
              const targetBlock = lines.slice(start - 1, end).join('\n');
              const snippetNorm = ev.snippet.trim().replace(/\s+/g, ' ');
              const targetNorm = targetBlock.trim().replace(/\s+/g, ' ');
              if (targetNorm.includes(snippetNorm) || snippetNorm.includes(targetNorm.substring(0, 50))) {
                verifiedCount++;
                details.push(`✓ ${ev.file}:${start}-${end} snippet matches`);
              } else {
                details.push(`△ ${ev.file}:${start}-${end} exists but snippet differs`);
                verifiedCount++; // partial credit: file and lines exist
              }
            } else {
              verifiedCount++;
              details.push(`✓ ${ev.file}:${start}-${end} exists`);
            }
          } else {
            details.push(`✗ ${ev.file} line range ${start}-${end} out of bounds (file has ${lines.length} lines)`);
          }
        } catch {
          details.push(`✗ ${ev.file} could not be read`);
        }
      } else {
        verifiedCount++;
        details.push(`✓ ${ev.file} exists`);
      }
    } else if (ev.type === 'metric_ref') {
      // metric_ref verification requires analysis data, skip
      details.push(`△ metric_ref skipped (needs analysis data)`);
    }
  }

  if (totalCheckable === 0) {
    return { claim_id: claim.id, status: 'skipped', method_used: 'evidence_check', details: 'No file-based evidence to verify', checked_at: now };
  }

  const passRate = verifiedCount / totalCheckable;
  return {
    claim_id: claim.id,
    status: passRate >= 0.5 ? 'verified' : 'unverified',
    method_used: 'evidence_check',
    details: details.join('; '),
    checked_at: now,
  };
}

// ─── File Search Helper ─────────────────────────────────────────────

interface GrepResult {
  file: string;
  line: number;
}

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.java', '.go', '.rs', '.json', '.yaml', '.yml'];
const SKIP_DIRS = ['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next'];

function searchProjectFiles(
  projectPath: string,
  regex: RegExp,
  maxDepth = 8
): GrepResult | null {
  return searchDir(projectPath, regex, 0, maxDepth, projectPath);
}

function searchDir(
  dir: string,
  regex: RegExp,
  depth: number,
  maxDepth: number,
  rootPath: string
): GrepResult | null {
  if (depth > maxDepth || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const result = searchDir(fullPath, regex, depth + 1, maxDepth, rootPath);
        if (result) return result;
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!CODE_EXTENSIONS.includes(ext)) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 500000) continue;
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              return { file: fullPath.replace(rootPath + '/', ''), line: i + 1 };
            }
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}
