/**
 * Test Taxonomy
 * 测试类型语义识别，基于 import 分析和内容模式匹配
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TestFile, TestType, TestFileMetrics, TestFileQuality, Language, CLASSIFICATION_RULES } from './types';
import { detectLanguage } from './module-graph';

// ─── Main Classification ─────────────────────────────────────────────────────

export function classifyTestFile(
  filePath: string,
  content: string,
  language: Language
): { type: TestType; evidence: string[] } {
  const evidence: string[] = [];
  const imports = extractImports(content, language);
  const fileName = path.basename(filePath).toLowerCase();
  
  // E2E detection (highest priority)
  const e2eImports = ['playwright', '@playwright/test', 'selenium', 'selenium-webdriver', 'cypress', 'puppeteer'];
  for (const imp of e2eImports) {
    if (imports.includes(imp)) {
      evidence.push(`import: ${imp}`);
      return { type: 'e2e', evidence };
    }
  }
  if (/e2e|\.e2e\.|_e2e\./.test(fileName)) {
    evidence.push(`filename pattern: e2e`);
    return { type: 'e2e', evidence };
  }
  
  // Contract detection
  const contractImports = ['pact', '@pact-foundation/pact', 'schemathesis', 'dredd', 'openapi'];
  for (const imp of contractImports) {
    if (imports.includes(imp)) {
      evidence.push(`import: ${imp}`);
      return { type: 'contract', evidence };
    }
  }
  if (/contract|\.contract\.|_contract\./.test(fileName)) {
    evidence.push(`filename pattern: contract`);
    return { type: 'contract', evidence };
  }
  
  // Property-based testing detection
  const propertyImports = ['hypothesis', 'fast-check', '@fast-check/jest', '@fast-check/vitest'];
  for (const imp of propertyImports) {
    if (imports.includes(imp)) {
      evidence.push(`import: ${imp}`);
      return { type: 'property', evidence };
    }
  }
  if (/@given\s*\(/.test(content) || /fc\.property\s*\(/.test(content)) {
    evidence.push(`content pattern: property-based test decorator`);
    return { type: 'property', evidence };
  }
  
  // Integration detection
  const integrationImports = ['supertest', 'requests', 'httpx', 'aiohttp', 'fastapi.testclient'];
  for (const imp of integrationImports) {
    if (imports.includes(imp)) {
      evidence.push(`import: ${imp}`);
      return { type: 'integration', evidence };
    }
  }
  if (/integration|\.integration\.|_integration\.|api_test|api\.test/.test(fileName)) {
    evidence.push(`filename pattern: integration`);
    return { type: 'integration', evidence };
  }
  // Check for TestClient usage (FastAPI)
  if (/TestClient\s*\(/.test(content)) {
    evidence.push(`content pattern: TestClient`);
    return { type: 'integration', evidence };
  }
  // Check for database fixtures without mocks
  if (/\bsession\b.*\bdb\b|\bconnection\b.*\bdatabase\b/i.test(content) && !/mock|patch/i.test(content)) {
    evidence.push(`content pattern: database access without mock`);
    return { type: 'integration', evidence };
  }
  
  // Default to unit
  evidence.push('default classification');
  return { type: 'unit', evidence };
}

// ─── Import Extraction ───────────────────────────────────────────────────────

function extractImports(content: string, language: Language): string[] {
  const imports: string[] = [];
  
  if (language === 'python') {
    // Python imports: import xxx, from xxx import yyy
    // Preserve full dotted path for accurate pattern detection (e.g. unittest.mock)
    const importMatches = content.matchAll(/^(?:from\s+(\S+)|import\s+(\S+))/gm);
    for (const match of importMatches) {
      const fullModule = (match[1] || match[2] || '').split(' ')[0];
      if (fullModule && !fullModule.startsWith('.')) {
        imports.push(fullModule.toLowerCase());
        // Also add the top-level package for compatibility
        const topLevel = fullModule.split('.')[0];
        if (topLevel !== fullModule) {
          imports.push(topLevel.toLowerCase());
        }
      }
    }
  } else if (language === 'typescript' || language === 'javascript') {
    // JS/TS imports: import xxx from 'yyy', require('yyy')
    const importMatches = content.matchAll(/(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g);
    for (const match of importMatches) {
      const module = match[1] || match[2] || '';
      if (module) {
        // Extract package name (handle scoped packages)
        const pkgName = module.startsWith('@') 
          ? module.split('/').slice(0, 2).join('/')
          : module.split('/')[0];
        imports.push(pkgName.toLowerCase());
      }
    }
  } else if (language === 'java') {
    // Java imports: import xxx.yyy.zzz;
    const importMatches = content.matchAll(/^import\s+(?:static\s+)?([^;]+);/gm);
    for (const match of importMatches) {
      const pkg = match[1].split('.').slice(0, 2).join('.');
      imports.push(pkg.toLowerCase());
    }
  }
  
  return [...new Set(imports)];
}

// ─── Test File Analysis ──────────────────────────────────────────────────────

export function analyzeTestFile(
  filePath: string,
  projectPath: string
): TestFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const language = detectLanguage(filePath);
    const relativePath = path.relative(projectPath, filePath);
    
    // Classify test type
    const { type, evidence } = classifyTestFile(filePath, content, language);
    
    // Calculate metrics
    const metrics = calculateTestFileMetrics(content, language);
    
    // Calculate quality
    const quality = calculateTestFileQuality(content, language, filePath);
    
    // Extract imports
    const imports = extractImports(content, language);
    
    // Determine module
    const module = determineModule(relativePath);
    
    return {
      path: filePath,
      relativePath,
      module,
      type,
      evidence,
      language,
      metrics,
      quality,
      imports,
    };
  } catch (err) {
    return null;
  }
}

// ─── Metrics Calculation ─────────────────────────────────────────────────────

function calculateTestFileMetrics(content: string, language: Language): TestFileMetrics {
  const lines = content.split('\n').length;
  const testCaseCount = countTestCases(content, language);
  const assertCount = countAsserts(content, language);
  const assertDensity = testCaseCount > 0 ? Math.round((assertCount / testCaseCount) * 100) / 100 : 0;
  
  return {
    lines,
    testCaseCount,
    assertCount,
    assertDensity,
  };
}

function countTestCases(content: string, language: Language): number {
  if (language === 'python') {
    // def test_xxx, async def test_xxx
    return (content.match(/(?:async\s+)?def\s+test_\w+/g) || []).length;
  } else if (language === 'typescript' || language === 'javascript') {
    // it('xxx'), test('xxx'), it.each, test.each
    return (content.match(/(?:it|test)\s*(?:\.each\s*\([^)]*\))?\s*\(/g) || []).length;
  } else if (language === 'java') {
    // @Test annotation
    return (content.match(/@Test\b/g) || []).length;
  }
  return 0;
}

function countAsserts(content: string, language: Language): number {
  if (language === 'python') {
    // assert xxx, self.assertXxx, pytest.raises
    const asserts = (content.match(/\bassert\s+|self\.assert\w+|pytest\.raises/g) || []).length;
    return asserts;
  } else if (language === 'typescript' || language === 'javascript') {
    // expect(xxx), assert.xxx
    return (content.match(/expect\s*\(|assert\.\w+/g) || []).length;
  } else if (language === 'java') {
    // assertXxx, assertEquals, assertTrue, etc.
    return (content.match(/assert\w+\s*\(/g) || []).length;
  }
  return 0;
}

// ─── Quality Calculation ─────────────────────────────────────────────────────

function calculateTestFileQuality(
  content: string,
  language: Language,
  filePath: string
): TestFileQuality {
  // Naming score
  const { score: namingScore, violations: namingViolations } = checkNaming(content, language);
  
  // Flaky risk
  const { risk: flakyRisk, reasons: flakyReasons } = detectFlakyRisk(content);
  
  // Isolation score
  const isolationScore = calculateIsolationScore(content, language);
  
  // Duplicate ratio (simplified - just check for repeated patterns)
  const duplicateRatio = estimateDuplicateRatio(content);
  
  return {
    namingScore,
    namingViolations,
    flakyRisk,
    flakyReasons,
    isolationScore,
    duplicateRatio,
  };
}

function checkNaming(content: string, language: Language): { score: number; violations: string[] } {
  const violations: string[] = [];
  let goodNames = 0;
  let totalNames = 0;
  
  // Extract test names
  let testNames: string[] = [];
  
  if (language === 'python') {
    const matches = content.matchAll(/def\s+(test_\w+)/g);
    testNames = [...matches].map(m => m[1]);
  } else if (language === 'typescript' || language === 'javascript') {
    const matches = content.matchAll(/(?:it|test)\s*\(\s*['"]([^'"]+)['"]/g);
    testNames = [...matches].map(m => m[1]);
  }
  
  for (const name of testNames) {
    totalNames++;
    
    // Check for behavior description patterns
    const goodPatterns = [
      /should\s+\w+/i,
      /when\s+\w+/i,
      /given\s+\w+/i,
      /returns?\s+\w+/i,
      /throws?\s+\w+/i,
      /creates?\s+\w+/i,
      /handles?\s+\w+/i,
      /_when_/,
      /_should_/,
      /_returns_/,
      /_with_/,
    ];
    
    if (goodPatterns.some(p => p.test(name))) {
      goodNames++;
    } else if (name.length < 10 || /^test_?\d+$/.test(name)) {
      violations.push(name);
    } else {
      goodNames += 0.5; // Partial credit for descriptive but not pattern-matching names
    }
  }
  
  const score = totalNames > 0 ? Math.round((goodNames / totalNames) * 100) : 100;
  return { score, violations: violations.slice(0, 5) };
}

function detectFlakyRisk(content: string): { risk: number; reasons: string[] } {
  const reasons: string[] = [];
  
  // Sleep/timeout
  if (/sleep\s*\(|time\.sleep|setTimeout|asyncio\.sleep/i.test(content)) {
    reasons.push('sleep/timeout usage');
  }
  
  // Time dependency
  if (/datetime\.now|Date\.now|new Date\(\)|time\.time\(\)/i.test(content)) {
    if (!/mock|patch|freeze/i.test(content)) {
      reasons.push('unmocked time dependency');
    }
  }
  
  // Randomness
  if (/random\.|Math\.random|uuid\.|secrets\./i.test(content)) {
    if (!/seed|mock|patch/i.test(content)) {
      reasons.push('unmocked randomness');
    }
  }
  
  // Network calls without mock
  if (/fetch\(|requests\.(get|post)|axios\.|httpx\.|aiohttp/i.test(content)) {
    if (!/mock|patch|responses\.|httpretty|nock|msw/i.test(content)) {
      reasons.push('unmocked network call');
    }
  }
  
  // File system operations
  if (/open\(|fs\.(read|write)|Path\(/i.test(content)) {
    if (!/mock|patch|tmp|temp/i.test(content)) {
      reasons.push('unmocked file system');
    }
  }
  
  const risk = Math.min(reasons.length * 25, 100);
  return { risk, reasons };
}

function calculateIsolationScore(content: string, language: Language): number {
  let score = 100;
  
  // Check for proper setup/teardown
  const hasSetup = /beforeEach|setUp|@Before|@pytest\.fixture|conftest/i.test(content);
  const hasTeardown = /afterEach|tearDown|@After/i.test(content);
  
  if (!hasSetup && !hasTeardown) {
    score -= 20;
  }
  
  // Check for mock usage
  const hasMocks = /mock|patch|jest\.fn|vi\.fn|MagicMock|mocker/i.test(content);
  if (!hasMocks) {
    score -= 30;
  }
  
  // Check for global state modification
  if (/global\.|window\.|process\.env\s*=/i.test(content)) {
    if (!/beforeEach|afterEach|setUp|tearDown/i.test(content)) {
      score -= 25;
    }
  }
  
  // Check for shared state
  if (/let\s+\w+\s*;|var\s+\w+\s*;/g.test(content)) {
    const matches = content.match(/let\s+\w+\s*;|var\s+\w+\s*;/g) || [];
    if (matches.length > 3) {
      score -= 15;
    }
  }
  
  return Math.max(score, 0);
}

function estimateDuplicateRatio(content: string): number {
  const lines = content.split('\n').filter(l => l.trim().length > 10);
  if (lines.length < 10) return 0;
  
  const lineSet = new Set(lines);
  const uniqueRatio = lineSet.size / lines.length;
  
  // If less than 70% unique, there's significant duplication
  const duplicateRatio = Math.round((1 - uniqueRatio) * 100);
  return Math.min(duplicateRatio, 100);
}

function determineModule(relativePath: string): string {
  const parts = relativePath.split(path.sep);
  
  // Skip test directories
  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  const filtered = parts.filter(p => !testDirs.includes(p.toLowerCase()));
  
  // Return first meaningful directory
  if (filtered.length > 1) {
    return filtered[0];
  }
  return 'root';
}

// ─── Batch Analysis ──────────────────────────────────────────────────────────

export function analyzeTestFiles(
  testFilePaths: string[],
  projectPath: string
): TestFile[] {
  const results: TestFile[] = [];
  
  for (const filePath of testFilePaths) {
    const result = analyzeTestFile(filePath, projectPath);
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

export { extractImports, countTestCases, countAsserts, detectFlakyRisk };
