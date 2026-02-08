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

export async function analyzeMetrics(projectPath: string): Promise<CodeMetrics> {
  let totalFiles = 0;
  let totalLines = 0;
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let totalFunctions = 0;
  let filesWithHighComplexity = 0;
  const fileSizes: FileMetric[] = [];

  const sourceFiles = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  });

  for (const file of sourceFiles) {
    const filePath = path.join(projectPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const lineCount = lines.length;
      
      totalFiles++;
      totalLines += lineCount;
      fileSizes.push({ file, lines: lineCount });

      let inBlockComment = false;
      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed === '') {
          blankLines++;
        } else if (inBlockComment) {
          commentLines++;
          if (trimmed.includes('*/')) {
            inBlockComment = false;
          }
        } else if (trimmed.startsWith('/*')) {
          commentLines++;
          if (!trimmed.includes('*/')) {
            inBlockComment = true;
          }
        } else if (trimmed.startsWith('//')) {
          commentLines++;
        } else {
          codeLines++;
        }
      }

      const functionMatches = content.match(/(?:function\s+\w+|(?:async\s+)?(?:\w+\s*)?(?:=>|\(.*\)\s*{))/g);
      const functionCount = functionMatches ? functionMatches.length : 0;
      totalFunctions += functionCount;

      if (lineCount > 500 || functionCount > 20) {
        filesWithHighComplexity++;
      }
    } catch {
      // Skip files that can't be read
    }
  }

  fileSizes.sort((a, b) => b.lines - a.lines);
  const largestFiles = fileSizes.slice(0, 10);

  return {
    totalFiles,
    totalLines,
    codeLines,
    commentLines,
    blankLines,
    avgFileSize: totalFiles > 0 ? Math.round(totalLines / totalFiles) : 0,
    largestFiles,
    complexity: {
      avgFunctionsPerFile: totalFiles > 0 ? Math.round((totalFunctions / totalFiles) * 10) / 10 : 0,
      avgLinesPerFunction: totalFunctions > 0 ? Math.round(codeLines / totalFunctions) : 0,
      filesWithHighComplexity,
    },
  };
}
