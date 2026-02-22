// Core types for dynamic and UI evaluation

export type EvaluationType = 'static' | 'dynamic' | 'ui' | 'full';
export type StageStatus = 'passed' | 'failed' | 'skipped' | 'needs_config' | 'running';
export type ReportStatus = 'passed' | 'failed' | 'partial';

export interface EvalConfig {
  projectPath: string;
  evaluationType: EvaluationType;
  projectName?: string;
  port?: number;
  baseUrl?: string;
  envFile?: string;
  timeout?: TimeoutConfig;
  reportDir?: string;
}

export interface TimeoutConfig {
  startup: number;   // ms, default 30000
  health: number;    // ms, default 10000
  api: number;       // ms, default 10000
  ui: number;        // ms, default 60000
}

export const DEFAULT_TIMEOUT: TimeoutConfig = {
  startup: 30000,
  health: 10000,
  api: 10000,
  ui: 60000,
};

export interface StartConfig {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  port: number;
  framework?: string;
  needsConfig?: boolean;
  configError?: string;
}

export interface StageResult {
  stage: 'static' | 'startup' | 'health' | 'api' | 'ui';
  status: StageStatus;
  duration_ms: number;
  score?: number;
  details: Record<string, unknown>;
  errors: string[];
  logs?: string;
}

export interface HealthCheckResult {
  reachable: boolean;
  endpoint: string;
  status_code?: number;
  response_time_ms: number;
  error?: string;
}

export interface ApiTestResult {
  endpoint: string;
  method: string;
  status: number;
  passed: boolean;
  response_time_ms: number;
  error?: string;
  note?: string;
}

export interface UiFlowStep {
  action: string;
  target?: string;
  value?: string;
  passed: boolean;
  screenshot?: string;
  error?: string;
  duration_ms: number;
}

export interface UiFlowResult {
  name: string;
  steps: UiFlowStep[];
  passed: boolean;
  duration_ms: number;
  console_errors: string[];
  network_errors: string[];
}

export interface EvalArtifacts {
  screenshots: string[];
  traces: string[];
  logs: string[];
}

export interface EvalMetrics {
  overall_score: number;
  static_score?: number;
  runtime_score?: number;
  ui_score?: number;
}

export interface EvalReport {
  id: string;
  projectPath: string;
  projectName: string;
  evaluationType: EvaluationType;
  status: ReportStatus;
  startedAt: string;
  completedAt: string;
  duration_ms: number;
  stages: StageResult[];
  artifacts: EvalArtifacts;
  metrics: EvalMetrics;
  errors: string[];
  warnings: string[];
  rerun_command: string;
}

export interface ProcessHandle {
  pid: number;
  kill: () => Promise<void>;
  waitForExit: () => Promise<number>;
  stdout: string;
  stderr: string;
}
