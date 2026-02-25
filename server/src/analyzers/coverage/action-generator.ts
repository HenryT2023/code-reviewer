/**
 * Action Generator
 * 生成可行动的测试改进建议
 */

import type { 
  ModuleNode, 
  TestFile, 
  ActionItem, 
  ActionType,
  QualityMetrics,
} from './types';

// ─── Main Action Generation ──────────────────────────────────────────────────

export function generateActionItems(
  modules: ModuleNode[],
  testFiles: TestFile[],
  quality: QualityMetrics
): ActionItem[] {
  const actions: ActionItem[] = [];
  let idCounter = 1;
  
  // 1. Critical modules without tests
  const criticalUncovered = modules
    .filter(m => m.criticality === 'high' && m.status === 'critical')
    .sort((a, b) => b.metrics.sourceFiles - a.metrics.sourceFiles);
  
  for (const mod of criticalUncovered.slice(0, 3)) {
    actions.push({
      id: `action-${idCounter++}`,
      priority: 'high',
      type: 'add_test',
      title: `为 ${mod.name} 模块添加单元测试`,
      description: `${mod.name} 是高优先级模块，包含 ${mod.metrics.sourceFiles} 个源文件，但测试覆盖率仅 ${Math.round(mod.metrics.testFileRatio * 100)}%`,
      targetModule: mod.name,
      expectedImpact: `+${Math.round(mod.metrics.sourceFiles * 0.1)} 测试文件，覆盖率提升约 ${Math.round(5 / modules.length * 100)}%`,
      effort: mod.metrics.sourceFiles > 20 ? 'large' : mod.metrics.sourceFiles > 10 ? 'medium' : 'small',
      testType: 'unit',
      labels: ['testing', 'high-priority', mod.name],
    });
  }
  
  // 2. Missing integration tests
  const hasIntegrationTests = testFiles.some(t => t.type === 'integration');
  if (!hasIntegrationTests && modules.some(m => m.name.includes('api') || m.name.includes('service'))) {
    const apiModule = modules.find(m => m.name.includes('api') || m.name.includes('service'));
    actions.push({
      id: `action-${idCounter++}`,
      priority: 'high',
      type: 'add_integration_test',
      title: '添加 API 集成测试',
      description: '项目缺少集成测试，建议为核心 API 端点添加集成测试以验证端到端流程',
      targetModule: apiModule?.name || 'api',
      expectedImpact: '提升 API 可靠性，减少回归 bug',
      effort: 'medium',
      testType: 'integration',
      labels: ['testing', 'integration', 'api'],
    });
  }
  
  // 3. Missing E2E tests
  const hasE2ETests = testFiles.some(t => t.type === 'e2e');
  const hasFrontend = modules.some(m => 
    m.name.includes('frontend') || m.name.includes('web') || m.name.includes('app') || m.language === 'typescript'
  );
  if (!hasE2ETests && hasFrontend) {
    actions.push({
      id: `action-${idCounter++}`,
      priority: 'medium',
      type: 'add_e2e_test',
      title: '添加 E2E 测试',
      description: '项目有前端代码但缺少 E2E 测试，建议使用 Playwright 或 Cypress 添加关键用户流程测试',
      targetModule: 'frontend',
      expectedImpact: '验证完整用户流程，提升产品质量',
      effort: 'medium',
      testType: 'e2e',
      labels: ['testing', 'e2e', 'frontend'],
    });
  }
  
  // 4. Flaky test fixes
  if (quality.dimensions.flakyRisk.riskFiles.length > 0) {
    for (const riskFile of quality.dimensions.flakyRisk.riskFiles.slice(0, 2)) {
      actions.push({
        id: `action-${idCounter++}`,
        priority: 'medium',
        type: 'fix_flaky',
        title: `修复 ${riskFile} 中的 flaky 风险`,
        description: '该测试文件存在不稳定因素（时间依赖、未 mock 的网络调用等），可能导致 CI 不稳定',
        targetModule: extractModule(riskFile),
        targetFile: riskFile,
        expectedImpact: '提升 CI 稳定性',
        effort: 'small',
        labels: ['testing', 'flaky', 'ci'],
      });
    }
  }
  
  // 5. Duplication reduction
  if (quality.dimensions.duplication.clusters.length > 0) {
    actions.push({
      id: `action-${idCounter++}`,
      priority: 'low',
      type: 'reduce_duplication',
      title: '重构重复的测试代码',
      description: `检测到 ${quality.dimensions.duplication.clusters.length} 处测试代码重复，建议提取公共 fixture 或 helper`,
      targetModule: 'tests',
      expectedImpact: '提升测试可维护性',
      effort: 'small',
      labels: ['testing', 'refactor', 'duplication'],
    });
  }
  
  // 6. Add mocks for isolation
  if (quality.dimensions.isolation.score < 60) {
    actions.push({
      id: `action-${idCounter++}`,
      priority: 'medium',
      type: 'add_mock',
      title: '增加测试隔离性',
      description: '测试隔离性评分较低，建议为外部依赖（数据库、网络、文件系统）添加 mock',
      targetModule: 'tests',
      expectedImpact: '提升测试稳定性和执行速度',
      effort: 'medium',
      labels: ['testing', 'mock', 'isolation'],
    });
  }
  
  // 7. Improve naming
  if (quality.dimensions.naming.violations > 5) {
    actions.push({
      id: `action-${idCounter++}`,
      priority: 'low',
      type: 'improve_naming',
      title: '改进测试命名',
      description: `${quality.dimensions.naming.violations} 个测试用例命名不够清晰，建议使用 should_xxx_when_xxx 模式`,
      targetModule: 'tests',
      expectedImpact: '提升测试可读性',
      effort: 'small',
      labels: ['testing', 'naming', 'readability'],
    });
  }
  
  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return actions;
}

// ─── Minimum Test Path ───────────────────────────────────────────────────────

export function calculateMinimumTestPath(
  modules: ModuleNode[]
): Array<{ module: string; impact: number; effort: string }> {
  // Sort modules by potential impact (criticality * uncovered files)
  const uncoveredModules = modules
    .filter(m => m.status !== 'good')
    .map(m => {
      const criticalityMultiplier = m.criticality === 'high' ? 3 : m.criticality === 'medium' ? 2 : 1;
      const uncoveredFiles = m.metrics.sourceFiles - m.metrics.testFiles;
      const impact = criticalityMultiplier * uncoveredFiles;
      const effort = uncoveredFiles > 20 ? 'large' : uncoveredFiles > 10 ? 'medium' : 'small';
      return { module: m.name, impact, effort };
    })
    .sort((a, b) => b.impact - a.impact);
  
  return uncoveredModules.slice(0, 5);
}

// ─── Role-Specific Recommendations ───────────────────────────────────────────

export function generateArchitectRecommendations(
  modules: ModuleNode[],
  quality: QualityMetrics
): string[] {
  const recommendations: string[] = [];
  
  // Top 5 uncovered critical modules
  const uncoveredCritical = modules
    .filter(m => m.criticality === 'high' && m.status === 'critical')
    .slice(0, 5);
  
  if (uncoveredCritical.length > 0) {
    recommendations.push(
      `**Top ${uncoveredCritical.length} 未覆盖关键模块**: ${uncoveredCritical.map(m => `${m.name} (${m.metrics.sourceFiles} 文件)`).join(', ')}`
    );
  }
  
  // Lowest coverage modules
  const lowestCoverage = modules
    .filter(m => m.metrics.lineCoverage !== undefined)
    .sort((a, b) => (a.metrics.lineCoverage || 0) - (b.metrics.lineCoverage || 0))
    .slice(0, 3);
  
  if (lowestCoverage.length > 0) {
    recommendations.push(
      `**Branch coverage 最低模块**: ${lowestCoverage.map(m => `${m.name} (${m.metrics.branchCoverage || m.metrics.lineCoverage}%)`).join(', ')}`
    );
  }
  
  // High-risk dependencies
  if (quality.dimensions.dependencySmell.hotspots.length > 0) {
    recommendations.push(
      `**高风险依赖热点**: ${quality.dimensions.dependencySmell.hotspots.join(', ')} - 建议增加隔离测试`
    );
  }
  
  return recommendations;
}

export function generateCoderRecommendations(
  modules: ModuleNode[],
  testFiles: TestFile[],
  quality: QualityMetrics
): string[] {
  const recommendations: string[] = [];
  
  // Minimum test path
  const minPath = calculateMinimumTestPath(modules);
  if (minPath.length > 0) {
    recommendations.push(
      `**最小补测路径**: 优先为 ${minPath.slice(0, 3).map(m => m.module).join(' → ')} 添加测试`
    );
  }
  
  // Specific file recommendations
  const criticalModules = modules.filter(m => m.criticality === 'high' && m.status === 'critical');
  for (const mod of criticalModules.slice(0, 2)) {
    const testType = mod.name.includes('api') || mod.name.includes('service') ? 'integration' : 'unit';
    recommendations.push(
      `为 \`${mod.name}/\` 添加 ${testType} 测试 (${mod.metrics.sourceFiles} 个源文件待覆盖)`
    );
  }
  
  // Test type suggestions
  const hasIntegration = testFiles.some(t => t.type === 'integration');
  const hasE2E = testFiles.some(t => t.type === 'e2e');
  
  if (!hasIntegration) {
    recommendations.push('建议添加 **集成测试** 覆盖 API 端点');
  }
  if (!hasE2E && modules.some(m => m.name.includes('frontend'))) {
    recommendations.push('建议添加 **E2E 测试** 覆盖关键用户流程');
  }
  
  return recommendations;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function extractModule(filePath: string): string {
  const parts = filePath.split('/');
  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  const filtered = parts.filter(p => !testDirs.includes(p.toLowerCase()));
  return filtered[0] || 'root';
}

export { calculateMinimumTestPath as getMinimumTestPath };
