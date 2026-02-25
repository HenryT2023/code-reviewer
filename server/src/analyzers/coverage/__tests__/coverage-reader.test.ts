/**
 * Coverage Reader Tests
 * 回归测试：选择、解析、合并、降级四条链路
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readCoverageReportSync } from '../coverage-reader';
import { analyzeCoverageIntelligenceSync } from '../index';

describe('readCoverageReportSync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 1: 无文件 → null
  test('returns null when no coverage files exist', () => {
    const result = readCoverageReportSync(tempDir);
    expect(result).toBeNull();
  });

  // Test 2: 仅 lcov → 返回对象，source=lcov
  test('returns lcov coverage when only lcov.info exists', () => {
    const coverageDir = path.join(tempDir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    
    const lcovContent = `TN:
SF:crm/foo.py
DA:1,1
DA:2,0
DA:3,1
LF:3
LH:2
end_of_record
`;
    fs.writeFileSync(path.join(coverageDir, 'lcov.info'), lcovContent);
    
    const result = readCoverageReportSync(tempDir);
    
    expect(result).not.toBeNull();
    expect(result?.source).toBe('lcov');
    expect(result?.overall.lines.percentage).toBe(67); // 2/3 ≈ 66.7% → 67%
  });

  // Test 3: lcov + cobertura → 选 lcov（优先级）
  test('prefers lcov over cobertura when both exist', () => {
    const coverageDir = path.join(tempDir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    
    // Create lcov
    const lcovContent = `TN:
SF:crm/foo.py
DA:1,1
DA:2,1
LF:2
LH:2
end_of_record
`;
    fs.writeFileSync(path.join(coverageDir, 'lcov.info'), lcovContent);
    
    // Create cobertura
    const coberturaContent = `<?xml version="1.0" ?>
<coverage version="1.0" lines-valid="10" lines-covered="5" line-rate="0.5">
  <packages>
    <package name="crm" line-rate="0.5">
      <classes>
        <class name="bar.py" filename="crm/bar.py" line-rate="0.5">
          <lines>
            <line number="1" hits="1"/>
            <line number="2" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;
    fs.writeFileSync(path.join(coverageDir, 'coverage.xml'), coberturaContent);
    
    const result = readCoverageReportSync(tempDir);
    
    expect(result).not.toBeNull();
    expect(result?.source).toBe('lcov');
    expect(result?.overall.lines.percentage).toBe(100); // lcov has 100% coverage
  });

  // Test 4: 损坏 xml → 不 throw（优雅降级）
  test('does not throw for corrupted xml', () => {
    const corruptedXml = `<?xml version="1.0" ?>
<coverage>
  <packages>
    <package name="crm"
      <!-- corrupted: missing closing tag -->
`;
    fs.writeFileSync(path.join(tempDir, 'coverage.xml'), corruptedXml);
    
    // Should not throw - may return empty coverage or null
    expect(() => {
      readCoverageReportSync(tempDir);
    }).not.toThrow();
  });

  // Test 5: 根目录 lcov.info
  test('finds lcov.info in root directory', () => {
    const lcovContent = `TN:
SF:src/main.ts
DA:1,1
DA:2,1
DA:3,0
LF:3
LH:2
end_of_record
`;
    fs.writeFileSync(path.join(tempDir, 'lcov.info'), lcovContent);
    
    const result = readCoverageReportSync(tempDir);
    
    expect(result).not.toBeNull();
    expect(result?.source).toBe('lcov');
  });
});

describe('analyzeCoverageIntelligenceSync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelligence-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 6: 有 lcov → isProxy=false 且有 modules/files
  test('returns real coverage when lcov exists', () => {
    const coverageDir = path.join(tempDir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    
    const lcovContent = `TN:
SF:src/foo.ts
DA:1,1
DA:2,0
DA:3,1
DA:4,1
LF:4
LH:3
end_of_record
SF:src/bar.ts
DA:1,1
DA:2,1
LF:2
LH:2
end_of_record
`;
    fs.writeFileSync(path.join(coverageDir, 'lcov.info'), lcovContent);
    
    // Create a minimal source directory
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'foo.ts'), 'export const foo = 1;');
    fs.writeFileSync(path.join(srcDir, 'bar.ts'), 'export const bar = 2;');
    
    const result = analyzeCoverageIntelligenceSync(tempDir, []);
    
    expect(result.meta.hasRealCoverage).toBe(true);
    expect(result.meta.coverageSource).toBe('lcov');
    expect(result.overview.hasRealCoverage).toBe(true);
  });

  // Test 7: 无 coverage → isProxy=true
  test('returns proxy coverage when no coverage files exist', () => {
    // Create a minimal source directory
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'foo.ts'), 'export const foo = 1;');
    
    const result = analyzeCoverageIntelligenceSync(tempDir, []);
    
    expect(result.meta.hasRealCoverage).toBe(false);
    expect(result.meta.coverageSource).toBe('proxy');
  });
});

describe('isMeaningfulCoverage fallback', () => {
  let tempDir: string;
  
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-meaningful-'));
  });
  
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('corrupted cobertura + valid lcov selects lcov', () => {
    // Create corrupted cobertura (empty/invalid)
    fs.writeFileSync(path.join(tempDir, 'coverage.xml'), '<invalid>not a coverage report</invalid>');
    
    // Create valid lcov
    const coverageDir = path.join(tempDir, 'coverage');
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.writeFileSync(path.join(coverageDir, 'lcov.info'), `SF:src/foo.ts
LF:10
LH:8
end_of_record`);
    
    const result = readCoverageReportSync(tempDir);
    
    expect(result).not.toBeNull();
    expect(result?.source).toBe('lcov');
    expect(result?.overall.lines.total).toBe(10);
  });

  test('only corrupted cobertura returns null (proxy fallback)', () => {
    // Create corrupted cobertura (empty/invalid)
    fs.writeFileSync(path.join(tempDir, 'coverage.xml'), '<invalid>not a coverage report</invalid>');
    
    const result = readCoverageReportSync(tempDir);
    
    expect(result).toBeNull();
  });

  test('empty cobertura with zero totals returns null', () => {
    // Create cobertura with zero totals
    fs.writeFileSync(path.join(tempDir, 'coverage.xml'), `<?xml version="1.0"?>
<coverage line-rate="0" branch-rate="0" lines-valid="0" lines-covered="0">
</coverage>`);
    
    const result = readCoverageReportSync(tempDir);
    
    expect(result).toBeNull();
  });
});
