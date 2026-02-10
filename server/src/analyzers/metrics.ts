import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface CodeMetrics {
  totalFiles: number;
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  avgFileSize: number;
  largestFiles: FileMetric[];
  complexity: ComplexityMetrics;
  languageBreakdown: Record<string, { files: number; lines: number }>;
}

export interface FileMetric {
  file: string;
  lines: number;
}

export interface ComplexityMetrics {
  avgFunctionsPerFile: number;
  avgLinesPerFunction: number;
  filesWithHighComplexity: number;
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.java', '.go', '.rs', '.rb'];
const IGNORE_DIRS = ['node_modules', 'dist', 'build', '.venv', 'venv', '__pycache__', '.git', 'coverage', '.next', '.mypy_cache', '.pytest_cache'];

export async function analyzeMetrics(projectPath: string): Promise<CodeMetrics> {
  let totalFiles = 0;
  let totalLines = 0;
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let totalFunctions = 0;
  let filesWithHighComplexity = 0;
  const fileSizes: FileMetric[] = [];
  const languageBreakdown: Record<string, { files: number; lines: number }> = {};

  const extGlob = EXTENSIONS.map(e => e.substring(1)).join(',');
  const sourceFiles = await glob(`**/*.{${extGlob}}`, {
    cwd: projectPath,
    ignore: IGNORE_DIRS.map(d => `**/${d}/**`),
  });

  for (const file of sourceFiles) {
    const filePath = path.join(projectPath, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 500000) continue; // skip large files

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const lineCount = lines.length;
      const ext = path.extname(file).toLowerCase();
      const isPython = ext === '.py';

      totalFiles++;
      totalLines += lineCount;
      fileSizes.push({ file, lines: lineCount });

      // Language breakdown
      if (!languageBreakdown[ext]) languageBreakdown[ext] = { files: 0, lines: 0 };
      languageBreakdown[ext].files++;
      languageBreakdown[ext].lines += lineCount;

      let inBlockComment = false;
      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') {
          blankLines++;
        } else if (isPython) {
          // Python comments
          if (trimmed.startsWith('#')) {
            commentLines++;
          } else if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
            commentLines++;
            if ((trimmed.match(/"""/g) || []).length === 1 || (trimmed.match(/'''/g) || []).length === 1) {
              inBlockComment = !inBlockComment;
            }
          } else if (inBlockComment) {
            commentLines++;
            if (trimmed.includes('"""') || trimmed.includes("'''")) {
              inBlockComment = false;
            }
          } else {
            codeLines++;
          }
        } else {
          // JS/TS comments
          if (inBlockComment) {
            commentLines++;
            if (trimmed.includes('*/')) inBlockComment = false;
          } else if (trimmed.startsWith('/*')) {
            commentLines++;
            if (!trimmed.includes('*/')) inBlockComment = true;
          } else if (trimmed.startsWith('//')) {
            commentLines++;
          } else {
            codeLines++;
          }
        }
      }

      // Count functions
      let functionCount = 0;
      if (isPython) {
        functionCount = (content.match(/(?:^|\n)\s*(?:async\s+)?def\s+\w+/g) || []).length;
      } else {
        functionCount = (content.match(/(?:function\s+\w+|(?:async\s+)?(?:\w+\s*)?(?:=>|\([^)]*\)\s*(?::\s*\w+)?\s*{))/g) || []).length;
      }
      totalFunctions += functionCount;

      if (lineCount > 500 || functionCount > 20) {
        filesWithHighComplexity++;
      }
    } catch {
      // Skip files that can't be read
    }
  }

  fileSizes.sort((a, b) => b.lines - a.lines);

  return {
    totalFiles,
    totalLines,
    codeLines,
    commentLines,
    blankLines,
    avgFileSize: totalFiles > 0 ? Math.round(totalLines / totalFiles) : 0,
    largestFiles: fileSizes.slice(0, 10),
    complexity: {
      avgFunctionsPerFile: totalFiles > 0 ? Math.round((totalFunctions / totalFiles) * 10) / 10 : 0,
      avgLinesPerFunction: totalFunctions > 0 ? Math.round(codeLines / totalFunctions) : 0,
      filesWithHighComplexity,
    },
    languageBreakdown,
  };
}
