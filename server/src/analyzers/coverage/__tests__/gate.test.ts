/**
 * PR Gate Tests
 * 覆盖率门禁测试
 */

import { computeGateResult } from '../gate';
import type { GateMetrics, BaselineCoverage } from '../types';

describe('computeGateResult', () => {
  const createBaseline = (metrics: GateMetrics): BaselineCoverage => ({
    version: 1,
    timestamp: '2024-01-01T00:00:00Z',
    metrics,
  });

  test('returns skipped when no baseline exists', () => {
    const current: GateMetrics = { lineCoverage: 60 };
    const result = computeGateResult(current, null);
    
    expect(result.status).toBe('skipped');
    expect(result.baselineSource).toBe('none');
    expect(result.reasons).toContain('No baseline found. Run with --save-baseline to create one.');
  });

  test('returns pass when real coverage drops within threshold', () => {
    const current: GateMetrics = { lineCoverage: 61.7 };
    const baseline = createBaseline({ lineCoverage: 62.0 });
    
    const result = computeGateResult(current, baseline, 'warn', true);
    
    expect(result.status).toBe('pass');
    expect(result.delta?.lineCoverage).toBeCloseTo(-0.3, 1);
  });

  test('returns warn when real coverage exceeds threshold', () => {
    const current: GateMetrics = { lineCoverage: 61.0 };
    const baseline = createBaseline({ lineCoverage: 62.0 });
    
    const result = computeGateResult(current, baseline, 'warn', true);
    
    expect(result.status).toBe('warn');
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toContain('Line coverage decreased');
  });

  test('returns warn when proxy testFileRatio decreases', () => {
    const current: GateMetrics = { testFileRatio: 0.065 };
    const baseline = createBaseline({ testFileRatio: 0.07 });
    
    const result = computeGateResult(current, baseline, 'warn', false);
    
    expect(result.status).toBe('warn');
    expect(result.reasons[0]).toContain('Test file ratio decreased');
  });

  test('returns pass when proxy metrics are stable', () => {
    const current: GateMetrics = { testFileRatio: 0.072, testQualityScore: 78 };
    const baseline = createBaseline({ testFileRatio: 0.07, testQualityScore: 75 });
    
    const result = computeGateResult(current, baseline, 'warn', false);
    
    expect(result.status).toBe('pass');
  });

  test('returns fail in fail mode when threshold exceeded', () => {
    const current: GateMetrics = { lineCoverage: 60.0 };
    const baseline = createBaseline({ lineCoverage: 62.0 });
    
    const result = computeGateResult(current, baseline, 'fail', true);
    
    expect(result.status).toBe('fail');
    expect(result.mode).toBe('fail');
  });
});
