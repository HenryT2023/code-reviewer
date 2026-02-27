/**
 * Coverage Report Reader
 * 解析 lcov, cobertura, jacoco 等覆盖率报告
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RealCoverage, CoverageStats, FileCoverage } from './types';

// ─── Coverage Validity Check ─────────────────────────────────────────────────

/**
 * Check if a coverage report is meaningful (has actual data).
 * Prevents corrupted/empty XML from being treated as real coverage.
 */
function isMeaningfulCoverage(report: RealCoverage | null): boolean {
  if (!report) return false;
  
  // Must have files or valid totals
  const hasFiles = report.files && report.files.length > 0;
  const hasTotals = report.overall.lines.total > 0;
  
  return hasFiles || hasTotals;
}

// ─── Main Entry ──────────────────────────────────────────────────────────────

export async function readCoverageReport(projectPath: string): Promise<RealCoverage | null> {
  // Try LCOV first (most common)
  const lcovPaths = [
    'coverage/lcov.info',
    'lcov.info',
    'coverage/lcov-report/lcov.info',
    'htmlcov/lcov.info',
  ];
  
  for (const lcovPath of lcovPaths) {
    const fullPath = path.join(projectPath, lcovPath);
    if (fs.existsSync(fullPath)) {
      const result = parseLcov(fullPath);
      if (isMeaningfulCoverage(result)) return result;
    }
  }
  
  // Try Cobertura XML
  const coberturaPaths = [
    'coverage.xml',
    'coverage/coverage.xml',
    'coverage/cobertura.xml',
    'target/site/cobertura/coverage.xml',
  ];
  
  for (const cobPath of coberturaPaths) {
    const fullPath = path.join(projectPath, cobPath);
    if (fs.existsSync(fullPath)) {
      const result = parseCobertura(fullPath);
      if (isMeaningfulCoverage(result)) return result;
    }
  }
  
  // Try JaCoCo XML
  const jacocoPaths = [
    'target/site/jacoco/jacoco.xml',
    'build/reports/jacoco/test/jacocoTestReport.xml',
    'jacoco.xml',
  ];
  
  for (const jacocoPath of jacocoPaths) {
    const fullPath = path.join(projectPath, jacocoPath);
    if (fs.existsSync(fullPath)) {
      const result = parseJacoco(fullPath);
      if (isMeaningfulCoverage(result)) return result;
    }
  }
  
  return null;
}

// ─── LCOV Parser ─────────────────────────────────────────────────────────────

function parseLcov(filePath: string): RealCoverage | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const files: FileCoverage[] = [];
    
    let totalLinesHit = 0;
    let totalLinesFound = 0;
    let totalBranchesHit = 0;
    let totalBranchesFound = 0;
    let totalFunctionsHit = 0;
    let totalFunctionsFound = 0;
    
    // Split by SF (source file) records
    const records = content.split('end_of_record').filter(r => r.trim());
    
    for (const record of records) {
      const lines = record.split('\n').map(l => l.trim()).filter(l => l);
      
      let currentFile = '';
      let linesHit = 0;
      let linesFound = 0;
      let branchesHit = 0;
      let branchesFound = 0;
      let functionsHit = 0;
      let functionsFound = 0;
      const uncoveredLines: number[] = [];
      
      for (const line of lines) {
        if (line.startsWith('SF:')) {
          currentFile = line.substring(3);
        } else if (line.startsWith('LH:')) {
          linesHit = parseInt(line.substring(3), 10) || 0;
        } else if (line.startsWith('LF:')) {
          linesFound = parseInt(line.substring(3), 10) || 0;
        } else if (line.startsWith('BRH:')) {
          branchesHit = parseInt(line.substring(4), 10) || 0;
        } else if (line.startsWith('BRF:')) {
          branchesFound = parseInt(line.substring(4), 10) || 0;
        } else if (line.startsWith('FNH:')) {
          functionsHit = parseInt(line.substring(4), 10) || 0;
        } else if (line.startsWith('FNF:')) {
          functionsFound = parseInt(line.substring(4), 10) || 0;
        } else if (line.startsWith('DA:')) {
          // DA:lineNumber,hitCount
          const parts = line.substring(3).split(',');
          if (parts.length >= 2 && parseInt(parts[1], 10) === 0) {
            uncoveredLines.push(parseInt(parts[0], 10));
          }
        }
      }
      
      if (currentFile) {
        totalLinesHit += linesHit;
        totalLinesFound += linesFound;
        totalBranchesHit += branchesHit;
        totalBranchesFound += branchesFound;
        totalFunctionsHit += functionsHit;
        totalFunctionsFound += functionsFound;
        
        files.push({
          path: currentFile,
          lines: {
            covered: linesHit,
            total: linesFound,
            percentage: linesFound > 0 ? Math.round((linesHit / linesFound) * 100) : 0,
          },
          branches: branchesFound > 0 ? {
            covered: branchesHit,
            total: branchesFound,
            percentage: Math.round((branchesHit / branchesFound) * 100),
          } : undefined,
          functions: functionsFound > 0 ? {
            covered: functionsHit,
            total: functionsFound,
            percentage: Math.round((functionsHit / functionsFound) * 100),
          } : undefined,
          uncoveredLines: uncoveredLines.length > 0 ? uncoveredLines : undefined,
        });
      }
    }
    
    if (files.length === 0) return null;
    
    return {
      source: 'lcov',
      overall: {
        lines: {
          covered: totalLinesHit,
          total: totalLinesFound,
          percentage: totalLinesFound > 0 ? Math.round((totalLinesHit / totalLinesFound) * 100) : 0,
        },
        branches: totalBranchesFound > 0 ? {
          covered: totalBranchesHit,
          total: totalBranchesFound,
          percentage: Math.round((totalBranchesHit / totalBranchesFound) * 100),
        } : undefined,
        functions: totalFunctionsFound > 0 ? {
          covered: totalFunctionsHit,
          total: totalFunctionsFound,
          percentage: Math.round((totalFunctionsHit / totalFunctionsFound) * 100),
        } : undefined,
      },
      files,
    };
  } catch (err) {
    console.error('Failed to parse LCOV:', err);
    return null;
  }
}

// ─── Cobertura Parser ────────────────────────────────────────────────────────

function parseCobertura(filePath: string): RealCoverage | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const files: FileCoverage[] = [];
    
    // Extract overall stats from coverage tag
    const coverageMatch = content.match(/<coverage[^>]*line-rate="([^"]+)"[^>]*branch-rate="([^"]+)"/);
    const lineRate = coverageMatch ? parseFloat(coverageMatch[1]) : 0;
    const branchRate = coverageMatch ? parseFloat(coverageMatch[2]) : 0;
    
    // Extract lines-valid and lines-covered
    const linesValidMatch = content.match(/lines-valid="(\d+)"/);
    const linesCoveredMatch = content.match(/lines-covered="(\d+)"/);
    const branchesValidMatch = content.match(/branches-valid="(\d+)"/);
    const branchesCoveredMatch = content.match(/branches-covered="(\d+)"/);
    
    const linesTotal = linesValidMatch ? parseInt(linesValidMatch[1], 10) : 0;
    const linesCovered = linesCoveredMatch ? parseInt(linesCoveredMatch[1], 10) : 0;
    const branchesTotal = branchesValidMatch ? parseInt(branchesValidMatch[1], 10) : 0;
    const branchesCovered = branchesCoveredMatch ? parseInt(branchesCoveredMatch[1], 10) : 0;
    
    // Extract per-file coverage
    const classMatches = content.matchAll(/<class[^>]*filename="([^"]+)"[^>]*line-rate="([^"]+)"[^>]*branch-rate="([^"]+)"/g);
    
    for (const match of classMatches) {
      const filename = match[1];
      const fileLineRate = parseFloat(match[2]);
      const fileBranchRate = parseFloat(match[3]);
      
      files.push({
        path: filename,
        lines: {
          covered: 0, // Cobertura doesn't give absolute numbers per file easily
          total: 0,
          percentage: Math.round(fileLineRate * 100),
        },
        branches: {
          covered: 0,
          total: 0,
          percentage: Math.round(fileBranchRate * 100),
        },
      });
    }
    
    return {
      source: 'cobertura',
      overall: {
        lines: {
          covered: linesCovered,
          total: linesTotal,
          percentage: Math.round(lineRate * 100),
        },
        branches: branchesTotal > 0 ? {
          covered: branchesCovered,
          total: branchesTotal,
          percentage: Math.round(branchRate * 100),
        } : undefined,
      },
      files,
    };
  } catch (err) {
    console.error('Failed to parse Cobertura:', err);
    return null;
  }
}

// ─── JaCoCo Parser ───────────────────────────────────────────────────────────

function parseJacoco(filePath: string): RealCoverage | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const files: FileCoverage[] = [];
    
    // Extract counters from report level
    const extractCounter = (type: string): { covered: number; missed: number } => {
      const regex = new RegExp(`<counter type="${type}" missed="(\\d+)" covered="(\\d+)"/>`);
      const match = content.match(regex);
      if (match) {
        return { missed: parseInt(match[1], 10), covered: parseInt(match[2], 10) };
      }
      return { missed: 0, covered: 0 };
    };
    
    const lineCounter = extractCounter('LINE');
    const branchCounter = extractCounter('BRANCH');
    const methodCounter = extractCounter('METHOD');
    
    const linesTotal = lineCounter.covered + lineCounter.missed;
    const branchesTotal = branchCounter.covered + branchCounter.missed;
    const methodsTotal = methodCounter.covered + methodCounter.missed;
    
    // Extract per-sourcefile coverage
    const sourcefileMatches = content.matchAll(/<sourcefile name="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g);
    
    for (const match of sourcefileMatches) {
      const filename = match[1];
      const fileContent = match[2];
      
      const fileLineMatch = fileContent.match(/<counter type="LINE" missed="(\d+)" covered="(\d+)"\/>/);
      const fileBranchMatch = fileContent.match(/<counter type="BRANCH" missed="(\d+)" covered="(\d+)"\/>/);
      
      if (fileLineMatch) {
        const missed = parseInt(fileLineMatch[1], 10);
        const covered = parseInt(fileLineMatch[2], 10);
        const total = missed + covered;
        
        let branches: FileCoverage['branches'];
        if (fileBranchMatch) {
          const bMissed = parseInt(fileBranchMatch[1], 10);
          const bCovered = parseInt(fileBranchMatch[2], 10);
          const bTotal = bMissed + bCovered;
          branches = {
            covered: bCovered,
            total: bTotal,
            percentage: bTotal > 0 ? Math.round((bCovered / bTotal) * 100) : 0,
          };
        }
        
        files.push({
          path: filename,
          lines: {
            covered,
            total,
            percentage: total > 0 ? Math.round((covered / total) * 100) : 0,
          },
          branches,
        });
      }
    }
    
    return {
      source: 'jacoco',
      overall: {
        lines: {
          covered: lineCounter.covered,
          total: linesTotal,
          percentage: linesTotal > 0 ? Math.round((lineCounter.covered / linesTotal) * 100) : 0,
        },
        branches: branchesTotal > 0 ? {
          covered: branchCounter.covered,
          total: branchesTotal,
          percentage: Math.round((branchCounter.covered / branchesTotal) * 100),
        } : undefined,
        functions: methodsTotal > 0 ? {
          covered: methodCounter.covered,
          total: methodsTotal,
          percentage: Math.round((methodCounter.covered / methodsTotal) * 100),
        } : undefined,
      },
      files,
    };
  } catch (err) {
    console.error('Failed to parse JaCoCo:', err);
    return null;
  }
}

// ─── Merge Coverage with Module Graph ────────────────────────────────────────

export function mergeCoverageWithModules(
  realCoverage: RealCoverage,
  modulePath: string,
  projectPath: string
): { lineCoverage?: number; branchCoverage?: number; functionCoverage?: number } {
  const relativePath = path.relative(projectPath, modulePath);
  
  // Find files that belong to this module
  const moduleFiles = realCoverage.files.filter(f => {
    const normalizedPath = f.path.replace(/\\/g, '/');
    return normalizedPath.includes(relativePath) || normalizedPath.startsWith(relativePath);
  });
  
  if (moduleFiles.length === 0) {
    return {};
  }
  
  // Calculate aggregate coverage
  let totalLines = 0;
  let coveredLines = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  
  for (const file of moduleFiles) {
    totalLines += file.lines.total;
    coveredLines += file.lines.covered;
    if (file.branches) {
      totalBranches += file.branches.total;
      coveredBranches += file.branches.covered;
    }
    if (file.functions) {
      totalFunctions += file.functions.total;
      coveredFunctions += file.functions.covered;
    }
  }
  
  return {
    lineCoverage: totalLines > 0 ? Math.round((coveredLines / totalLines) * 100) : undefined,
    branchCoverage: totalBranches > 0 ? Math.round((coveredBranches / totalBranches) * 100) : undefined,
    functionCoverage: totalFunctions > 0 ? Math.round((coveredFunctions / totalFunctions) * 100) : undefined,
  };
}

// ─── Sync Version ────────────────────────────────────────────────────────────

export function readCoverageReportSync(projectPath: string): RealCoverage | null {
  // Try LCOV first (most common)
  const lcovPaths = [
    'coverage/lcov.info',
    'lcov.info',
    'coverage/lcov-report/lcov.info',
    'htmlcov/lcov.info',
  ];
  
  // Also scan service subdirectories for lcov (monorepo support)
  try {
    const serviceDirNames = ['services', 'packages', 'apps'];
    for (const sd of serviceDirNames) {
      const sdPath = path.join(projectPath, sd);
      if (fs.existsSync(sdPath)) {
        const subDirs = fs.readdirSync(sdPath, { withFileTypes: true });
        for (const sub of subDirs) {
          if (sub.isDirectory() && !sub.name.startsWith('.')) {
            lcovPaths.push(`${sd}/${sub.name}/coverage/lcov.info`);
            lcovPaths.push(`${sd}/${sub.name}/htmlcov/lcov.info`);
          }
        }
      }
    }
  } catch { /* ignore */ }
  
  for (const lcovPath of lcovPaths) {
    const fullPath = path.join(projectPath, lcovPath);
    if (fs.existsSync(fullPath)) {
      const result = parseLcov(fullPath);
      if (isMeaningfulCoverage(result)) return result;
    }
  }
  
  // Try Cobertura XML (including monorepo subdirectory patterns)
  const coberturaPaths = [
    'coverage.xml',
    'coverage/coverage.xml',
    'coverage/cobertura.xml',
    'target/site/cobertura/coverage.xml',
  ];
  
  // Scan service subdirectories for coverage.xml (monorepo support)
  try {
    const serviceDirNames2 = ['services', 'packages', 'apps'];
    for (const sd of serviceDirNames2) {
      const sdPath = path.join(projectPath, sd);
      if (fs.existsSync(sdPath)) {
        const subDirs = fs.readdirSync(sdPath, { withFileTypes: true });
        for (const sub of subDirs) {
          if (sub.isDirectory() && !sub.name.startsWith('.')) {
            coberturaPaths.push(`${sd}/${sub.name}/coverage.xml`);
            coberturaPaths.push(`${sd}/${sub.name}/coverage/coverage.xml`);
          }
        }
      }
    }
  } catch { /* ignore */ }
  
  for (const cobPath of coberturaPaths) {
    const fullPath = path.join(projectPath, cobPath);
    if (fs.existsSync(fullPath)) {
      const result = parseCobertura(fullPath);
      if (isMeaningfulCoverage(result)) return result;
    }
  }
  
  // Try JaCoCo XML
  const jacocoPaths = [
    'target/site/jacoco/jacoco.xml',
    'build/reports/jacoco/test/jacocoTestReport.xml',
    'jacoco.xml',
  ];
  
  for (const jacocoPath of jacocoPaths) {
    const fullPath = path.join(projectPath, jacocoPath);
    if (fs.existsSync(fullPath)) {
      const result = parseJacoco(fullPath);
      if (isMeaningfulCoverage(result)) return result;
    }
  }
  
  return null;
}
