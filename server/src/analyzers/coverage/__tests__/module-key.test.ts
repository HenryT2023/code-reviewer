/**
 * Module Key Tests
 * 模块 key 标准化测试
 */

import { normalizeModuleKey, moduleKeyFromFilePath, moduleKeysMatch } from '../module-key';

describe('normalizeModuleKey', () => {
  test('strips server/ prefix', () => {
    expect(normalizeModuleKey('server/crm')).toBe('crm');
  });

  test('strips src/ prefix', () => {
    expect(normalizeModuleKey('src/api/routes')).toBe('api');
  });

  test('handles Windows path separators', () => {
    expect(normalizeModuleKey('src\\api\\bar.ts')).toBe('api');
  });

  test('returns first segment for simple paths', () => {
    expect(normalizeModuleKey('frontend')).toBe('frontend');
  });

  test('handles nested paths', () => {
    expect(normalizeModuleKey('server/crm/foo.py')).toBe('crm');
  });

  test('handles empty input', () => {
    expect(normalizeModuleKey('')).toBe('');
  });
});

describe('moduleKeyFromFilePath', () => {
  test('extracts module key from absolute path', () => {
    const result = moduleKeyFromFilePath('/Users/hal/project/crm/foo.py', '/Users/hal/project');
    expect(result).toBe('crm');
  });

  test('handles src prefix in path', () => {
    const result = moduleKeyFromFilePath('/Users/hal/project/src/api/routes.ts', '/Users/hal/project');
    expect(result).toBe('api');
  });

  test('handles Windows paths', () => {
    const result = moduleKeyFromFilePath('C:\\Users\\hal\\project\\src\\api\\routes.ts', 'C:\\Users\\hal\\project');
    expect(result).toBe('api');
  });
});

describe('moduleKeysMatch', () => {
  test('matches equivalent keys', () => {
    expect(moduleKeysMatch('server/crm', 'crm')).toBe(true);
  });

  test('matches with different prefixes', () => {
    expect(moduleKeysMatch('src/api', 'server/api')).toBe(true);
  });

  test('does not match different modules', () => {
    expect(moduleKeysMatch('crm', 'api')).toBe(false);
  });
});
