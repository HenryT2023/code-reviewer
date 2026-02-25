/**
 * Module Key Normalization
 * 统一模块 key 的标准化函数，用于对齐 legacy 和 intelligence 的模块名
 */

const STRIP_PREFIXES = ['server/', 'src/', './', 'lib/', 'app/'];

/**
 * Normalize a module name/path to a stable key.
 * Strips common prefixes and takes the first directory segment.
 * 
 * Examples:
 * - 'server/crm' -> 'crm'
 * - 'src/api/routes' -> 'api'
 * - 'frontend' -> 'frontend'
 * - 'src\\api\\bar.ts' (Windows) -> 'api'
 */
export function normalizeModuleKey(input: string): string {
  if (!input) return input;
  
  // Normalize path separators (Windows -> Unix)
  let s = input.replace(/\\/g, '/').trim();
  
  // Strip common prefixes
  for (const p of STRIP_PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
    }
  }
  
  // Remove leading slashes
  s = s.replace(/^\/+/, '');
  
  // Take first segment as module key
  const first = s.split('/')[0];
  return first || input;
}

/**
 * Get module key from a file path relative to project root.
 * 
 * @param filePath - Absolute or relative file path
 * @param projectRoot - Project root directory
 * @returns Normalized module key
 */
export function moduleKeyFromFilePath(filePath: string, projectRoot: string): string {
  // Normalize both paths
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
  
  // Get relative path
  let rel = normalizedFile;
  if (normalizedFile.startsWith(normalizedRoot)) {
    rel = normalizedFile.slice(normalizedRoot.length);
  }
  
  // Remove leading slashes
  rel = rel.replace(/^\/+/, '');
  
  return normalizeModuleKey(rel);
}

/**
 * Check if two module keys are equivalent after normalization.
 */
export function moduleKeysMatch(key1: string, key2: string): boolean {
  return normalizeModuleKey(key1) === normalizeModuleKey(key2);
}
