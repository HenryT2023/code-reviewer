import { useState, useEffect, useCallback } from 'react';
import {
  Card, Form, Input, Button, Checkbox, message, Steps, Result, Radio,
  Tooltip, Collapse, Select, Space, Typography, Tag, Switch, Alert,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpenOutlined, RocketOutlined, ThunderboltOutlined, SearchOutlined,
  EditOutlined, SaveOutlined, ImportOutlined, CheckSquareOutlined, MinusSquareOutlined,
  StarOutlined, ExperimentOutlined,
} from '@ant-design/icons';
import { evaluationApi } from '../services/api';

const { TextArea } = Input;
const { Text } = Typography;

const PRESETS_KEY = 'code-reviewer-role-presets';
const ROLES_STORAGE_KEY = 'code-reviewer-selected-roles';

const ALL_ROLE_KEYS = ['boss', 'merchant', 'operator', 'architect', 'growth', 'skeptic', 'pricing', 'data_metrics', 'delivery', 'artist'];
const PRIMARY_ROLE_KEYS = ['boss', 'merchant', 'operator', 'architect'];
const RECOMMENDED_ROLES = ['boss', 'merchant', 'architect'];
const DEFAULT_ROLES = ['boss', 'merchant', 'operator', 'architect'];

function loadSavedRoles(): string[] {
  try {
    const raw = localStorage.getItem(ROLES_STORAGE_KEY);
    if (!raw) return DEFAULT_ROLES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ROLES;
    const valid = parsed.filter((r: unknown) => typeof r === 'string' && ALL_ROLE_KEYS.includes(r as string));
    return valid.length > 0 ? valid : DEFAULT_ROLES;
  } catch { return DEFAULT_ROLES; }
}

function saveRolesToStorage(roles: string[]) {
  localStorage.setItem(ROLES_STORAGE_KEY, JSON.stringify(roles));
}

function getRoleBiasHint(roles: string[]): string {
  if (roles.length === 0) return '';
  const tags: string[] = [];
  const marketRoles = ['boss', 'merchant', 'pricing', 'growth'];
  const opsRoles = ['operator', 'delivery', 'data_metrics'];
  const techRoles = ['architect', 'skeptic'];
  const hasMarket = roles.some(r => marketRoles.includes(r));
  const hasOps = roles.some(r => opsRoles.includes(r));
  const hasTech = roles.some(r => techRoles.includes(r));
  if (hasMarket) tags.push('市场/商业');
  if (hasTech) tags.push('技术/架构');
  if (hasOps) tags.push('运营/交付');
  if (tags.length === 0) return '';
  return `已选择 ${roles.length} 个视角，评测更偏向：${tags.join(' + ')}`;
}

interface RolePreset {
  name: string;
  prompts: Record<string, string>;
}

const ROLE_LABELS: Record<string, string> = {
  boss: '👔 老板视角',
  merchant: '🏪 商户视角',
  operator: '⚙️ 运营视角',
  architect: '🏗️ 架构师视角',
  growth: '📈 增长/分发',
  skeptic: '🔴 质疑者/红队',
  pricing: '💰 定价策略',
  data_metrics: '📊 数据与指标',
  delivery: '🚀 交付经理',
  artist: '🎨 体验设计',
};

function loadPresets(): RolePreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePresets(presets: RolePreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

const Evaluate = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [evaluationId, setEvaluationId] = useState<string | null>(null);

  const [useCustomPrompts, setUseCustomPrompts] = useState(false);
  const [rolePrompts, setRolePrompts] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<RolePreset[]>([]);
  const [presetName, setPresetName] = useState('');

  useEffect(() => { setPresets(loadPresets()); }, []);

  const primaryRoleOptions = [
    { label: '👔 老板视角 (战略决策)', value: 'boss' },
    { label: '🏪 商户视角 (目标用户)', value: 'merchant' },
    { label: '⚙️ 运营视角 (日常管理)', value: 'operator' },
    { label: '🏗️ 架构师视角 (技术深度)', value: 'architect' },
  ];

  const extendedRoleOptions = [
    { label: '📈 增长/分发 (获客留存)', value: 'growth' },
    { label: '🔴 质疑者/红队 (找致命缺陷)', value: 'skeptic' },
    { label: '💰 定价策略 (商业化)', value: 'pricing' },
    { label: '📊 数据与指标 (埋点/看板)', value: 'data_metrics' },
    { label: '🚀 交付经理 (项目管理)', value: 'delivery' },
    { label: '🎨 体验设计 (美学/情感)', value: 'artist' },
  ];

  const evaluationMode = Form.useWatch('mode', form) || 'standard';
  const watchedDepth = Form.useWatch('depth', form) || 'quick';

  const handleSavePreset = useCallback(() => {
    if (!presetName.trim()) { message.warning('请输入预设名称'); return; }
    const existing = presets.filter(p => p.name !== presetName.trim());
    const updated = [...existing, { name: presetName.trim(), prompts: { ...rolePrompts } }];
    setPresets(updated);
    savePresets(updated);
    message.success(`预设「${presetName.trim()}」已保存`);
  }, [presetName, rolePrompts, presets]);

  const handleLoadPreset = useCallback((name: string) => {
    const preset = presets.find(p => p.name === name);
    if (preset) {
      setRolePrompts({ ...preset.prompts });
      setUseCustomPrompts(true);
      message.success(`已加载预设「${name}」`);
    }
  }, [presets]);

  const handleDeletePreset = useCallback((name: string) => {
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    savePresets(updated);
    message.info(`已删除预设「${name}」`);
  }, [presets]);

  const handleImportFromFile = useCallback(async () => {
    try {
      const res = await fetch('/prompts/ddt-monodt-roles.json');
      if (!res.ok) {
        message.error('无法加载预设文件，请确认文件路径');
        return;
      }
      const data = await res.json();
      setRolePrompts(data);
      setUseCustomPrompts(true);
      message.success('已从服务端导入角色 Prompt');
    } catch {
      message.error('导入失败');
    }
  }, []);

  const handleSubmit = async (values: {
    projectPath: string;
    projectName: string;
    roles: string[];
    context: string;
    depth: string;
    mode: string;
    evaluationType?: string;
    launchWindow?: string;
    launchChannels?: string;
    launchConstraints?: string;
    pricingExpectation?: string;
  }) => {
    setLoading(true);
    setCurrentStep(1);

    const selectedRoles = values.roles || ['boss', 'merchant', 'operator'];
    const promptsToSend: Record<string, string> = {};
    if (useCustomPrompts) {
      for (const role of selectedRoles) {
        if (rolePrompts[role]?.trim()) {
          promptsToSend[role] = rolePrompts[role].trim();
        }
      }
    }

    const payload: Record<string, unknown> = {
      projectPath: values.projectPath,
      projectName: values.projectName,
      roles: selectedRoles,
      context: values.context || '',
      depth: values.depth || 'quick',
      mode: values.mode || 'standard',
      evaluationType: values.evaluationType || 'static',
      ...(Object.keys(promptsToSend).length > 0 ? { rolePrompts: promptsToSend } : {}),
    };

    if (values.mode === 'launch-ready') {
      payload.launchContext = {
        launchWindow: values.launchWindow || '',
        channels: values.launchChannels ? values.launchChannels.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        constraints: values.launchConstraints || '',
        pricingExpectation: values.pricingExpectation || '',
      };
    }

    try {
      const res = await evaluationApi.startEvaluation(payload);

      setEvaluationId(res.data.id);
      message.success('评测已启动');
      setCurrentStep(2);

      pollStatus(res.data.id);
    } catch (error) {
      message.error('启动评测失败');
      setCurrentStep(0);
    }
    setLoading(false);
  };

  const pollStatus = async (id: string) => {
    const checkStatus = async () => {
      try {
        const res = await evaluationApi.getEvaluation(id);
        if (res.data.status === 'completed') {
          setCurrentStep(3);
          message.success('评测完成！');
        } else if (res.data.status === 'failed') {
          message.error('评测失败');
          setCurrentStep(0);
        } else {
          setTimeout(checkStatus, 3000);
        }
      } catch {
        setTimeout(checkStatus, 5000);
      }
    };
    checkStatus();
  };

  const selectedRoles: string[] = Form.useWatch('roles', form) || [];
  const biasHint = getRoleBiasHint(selectedRoles);

  // Persist roles to localStorage whenever they change
  useEffect(() => {
    if (selectedRoles && selectedRoles.length > 0) {
      saveRolesToStorage(selectedRoles);
    }
  }, [selectedRoles]);

  return (
    <div>
      <Steps
        current={currentStep}
        items={[
          { title: '配置项目' },
          { title: '代码分析' },
          { title: 'AI 评测' },
          { title: '生成报告' },
        ]}
        style={{ marginBottom: 32 }}
      />

      {currentStep === 0 && (
        <Card title="发起项目评测">
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{
              roles: loadSavedRoles(),
              mode: 'standard',
              evaluationType: 'static',
              projectPath: '/Users/hal/DDT-Monodt',
              projectName: 'DDT-Monodt',
              context: 'DDT+ 数字孪生仓库管理操作系统（Monorepo），包含 WMS 后端(Python FastAPI)、WMS 前端(React)、ControlPlane 智能体操作系统、TradeOS 合规接口等子服务。面向香港分销行业，提供事件驱动的仓库管理和AI辅助运营。采用 Agent-First 三层架构（Agent Swarm → Skills → Case/Workflow），12 个 Skills、6 个 DomainAgents、24+ 意图路由、170 个自动化测试。',
              depth: 'deep',
            }}
          >
            <Form.Item
              name="projectPath"
              label="项目路径"
              rules={[{ required: true, message: '请输入项目路径' }]}
            >
              <Input
                prefix={<FolderOpenOutlined />}
                placeholder="/path/to/your/project"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="projectName"
              label="项目名称"
              rules={[{ required: true, message: '请输入项目名称' }]}
            >
              <Input placeholder="例如：DDT-Monodt" size="large" />
            </Form.Item>

            <Form.Item
              name="context"
              label="业务背景"
              extra="描述项目的业务场景，帮助 AI 更好地理解和评估"
            >
              <TextArea
                rows={3}
                placeholder="例如：DDT+ 数字孪生仓库管理操作系统..."
              />
            </Form.Item>

            <Form.Item
              name="depth"
              label={
                <span>
                  评测深度&nbsp;
                  <Tooltip title="深度评测会读取实际代码文件、Spec文档、架构模式，提供更准确的评分">
                    <SearchOutlined />
                  </Tooltip>
                </span>
              }
            >
              <Radio.Group>
                <Radio.Button value="quick">
                  <ThunderboltOutlined /> 快速评测
                </Radio.Button>
                <Radio.Button value="deep">
                  <SearchOutlined /> 深度评测
                </Radio.Button>
              </Radio.Group>
            </Form.Item>

            <Form.Item
              name="evaluationType"
              label={
                <span>
                  评测类型&nbsp;
                  <Tooltip title="静态分析仅分析代码；动态评测会启动应用并测试API；UI评测会使用Playwright测试界面；完整评测包含所有类型">
                    <ExperimentOutlined />
                  </Tooltip>
                </span>
              }
            >
              <Radio.Group>
                <Radio.Button value="static">
                  📊 静态分析
                </Radio.Button>
                <Radio.Button value="dynamic">
                  🚀 动态评测
                </Radio.Button>
                <Radio.Button value="ui">
                  🎭 UI 评测
                </Radio.Button>
                <Radio.Button value="full">
                  ⚡ 完整评测
                </Radio.Button>
              </Radio.Group>
            </Form.Item>

            <Form.Item
              name="mode"
              label="评测模式"
            >
              <Radio.Group>
                <Radio.Button value="standard">
                  📋 标准评测
                </Radio.Button>
                <Radio.Button value="launch-ready">
                  🎯 Launch-Ready 评测
                </Radio.Button>
              </Radio.Group>
            </Form.Item>

            {evaluationMode === 'launch-ready' && (
              <Card size="small" style={{ marginBottom: 16, background: '#f6ffed', border: '1px solid #b7eb8f' }}>
                <Form.Item name="launchWindow" label="上线窗口" style={{ marginBottom: 8 }}>
                  <Input placeholder="例如：7天内上线、2周后 beta" />
                </Form.Item>
                <Form.Item name="launchChannels" label="目标渠道（逗号分隔）" style={{ marginBottom: 8 }}>
                  <Input placeholder="例如：微信群, 小红书, Product Hunt" />
                </Form.Item>
                <Form.Item name="launchConstraints" label="约束条件" style={{ marginBottom: 8 }}>
                  <Input placeholder="例如：单人团队，预算<5k" />
                </Form.Item>
                <Form.Item name="pricingExpectation" label="定价预期" style={{ marginBottom: 0 }}>
                  <Input placeholder="例如：SaaS 月费 ¥99-299" />
                </Form.Item>
              </Card>
            )}

            {watchedDepth === 'deep' && selectedRoles.length < 4 && selectedRoles.length > 0 && (
              <Alert
                type="info"
                showIcon
                message="深度评测建议选择至少 4 个角色以获得更全面的评估"
                style={{ marginBottom: 16 }}
                action={
                  <Button size="small" onClick={() => form.setFieldsValue({ roles: PRIMARY_ROLE_KEYS })}>
                    一键选择 4 主角色
                  </Button>
                }
              />
            )}

            <Form.Item
              name="roles"
              label={
                <Space>
                  <span>评测视角（Code Viewers）</span>
                  <Button size="small" icon={<CheckSquareOutlined />} onClick={() => form.setFieldsValue({ roles: ALL_ROLE_KEYS })}>全选</Button>
                  <Button size="small" icon={<MinusSquareOutlined />} onClick={() => form.setFieldsValue({ roles: [] })}>全不选</Button>
                  <Button size="small" type="dashed" icon={<StarOutlined />} onClick={() => form.setFieldsValue({ roles: RECOMMENDED_ROLES })}>推荐配置</Button>
                  <Button size="small" type="dashed" icon={<ExperimentOutlined />} onClick={() => form.setFieldsValue({ roles: PRIMARY_ROLE_KEYS })}>深度全选</Button>
                </Space>
              }
              rules={[{ required: true, message: '请至少选择一个角色' }]}
            >
              <Checkbox.Group>
                <div style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>主评审</Text>
                </div>
                <div style={{ marginBottom: 12 }}>
                  {primaryRoleOptions.map(o => (
                    <Checkbox key={o.value} value={o.value} style={{ marginRight: 16, marginBottom: 4 }}>{o.label}</Checkbox>
                  ))}
                </div>
                <div style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>攻防与增长{evaluationMode === 'launch-ready' ? ' (Launch-Ready 推荐全选)' : ''}</Text>
                </div>
                <div>
                  {extendedRoleOptions.map(o => (
                    <Checkbox key={o.value} value={o.value} style={{ marginRight: 16, marginBottom: 4 }}>{o.label}</Checkbox>
                  ))}
                </div>
              </Checkbox.Group>
            </Form.Item>

            {biasHint && (
              <div style={{ marginTop: -12, marginBottom: 16, padding: '6px 12px', background: '#f0f5ff', borderRadius: 4, fontSize: 13 }}>
                💡 {biasHint}
              </div>
            )}

            {selectedRoles.length === 0 && (
              <div style={{ marginTop: -12, marginBottom: 16 }}>
                <Text type="danger">⚠️ 请至少选择 1 个评测视角</Text>
              </div>
            )}

            {/* Custom Role Prompts Panel */}
            <Form.Item label={
              <Space>
                <EditOutlined />
                <span>自定义角色 Prompt</span>
                <Switch
                  size="small"
                  checked={useCustomPrompts}
                  onChange={setUseCustomPrompts}
                />
                {useCustomPrompts && (
                  <Tag color="blue">已启用</Tag>
                )}
              </Space>
            }>
              {useCustomPrompts && (
                <div style={{ marginBottom: 12 }}>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <Button
                      size="small"
                      icon={<ImportOutlined />}
                      onClick={handleImportFromFile}
                    >
                      导入 DDT-Monodt 专用角色
                    </Button>
                    {presets.length > 0 && (
                      <Select
                        size="small"
                        placeholder="加载已保存预设"
                        style={{ width: 180 }}
                        onChange={handleLoadPreset}
                        value={undefined}
                        options={presets.map(p => ({ label: p.name, value: p.name }))}
                      />
                    )}
                  </Space>
                  <Space style={{ marginBottom: 12 }}>
                    <Input
                      size="small"
                      placeholder="预设名称"
                      value={presetName}
                      onChange={e => setPresetName(e.target.value)}
                      style={{ width: 160 }}
                    />
                    <Button size="small" icon={<SaveOutlined />} onClick={handleSavePreset}>
                      保存预设
                    </Button>
                    {presets.length > 0 && (
                      <Select
                        size="small"
                        placeholder="删除预设"
                        style={{ width: 140 }}
                        onChange={handleDeletePreset}
                        value={undefined}
                        options={presets.map(p => ({ label: `删除: ${p.name}`, value: p.name }))}
                      />
                    )}
                  </Space>

                  <Collapse
                    size="small"
                    items={selectedRoles.map(role => ({
                      key: role,
                      label: (
                        <Space>
                          <span>{ROLE_LABELS[role] || role}</span>
                          {rolePrompts[role]?.trim() ? (
                            <Tag color="green" style={{ fontSize: 11 }}>
                              {rolePrompts[role].length} 字
                            </Tag>
                          ) : (
                            <Tag style={{ fontSize: 11 }}>使用默认</Tag>
                          )}
                        </Space>
                      ),
                      children: (
                        <div>
                          <TextArea
                            rows={8}
                            value={rolePrompts[role] || ''}
                            onChange={e => setRolePrompts(prev => ({ ...prev, [role]: e.target.value }))}
                            placeholder={`自定义 ${ROLE_LABELS[role] || role} 的系统 Prompt...\n留空则使用内置默认 Prompt`}
                            style={{ fontFamily: 'monospace', fontSize: 12 }}
                          />
                          <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                            留空 = 使用内置默认 Prompt。自定义后将完全替代默认 Prompt。
                          </Text>
                        </div>
                      ),
                    }))}
                  />
                </div>
              )}
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<RocketOutlined />}
                size="large"
                loading={loading}
                disabled={selectedRoles.length === 0}
              >
                开始评测
              </Button>
            </Form.Item>
          </Form>
        </Card>
      )}

      {(currentStep === 1 || currentStep === 2) && (
        <Card>
          <Result
            status="info"
            title={currentStep === 1 ? '正在深度分析代码...' : '正在进行 AI 评测...'}
            subTitle={currentStep === 1 
              ? '扫描子服务、API端点、数据模型、代码样本...' 
              : '多角色 AI 正在评估中，深度评测可能需要 2-5 分钟'}
            extra={
              <Button loading>
                {currentStep === 1 ? '分析中' : '评测中'}
              </Button>
            }
          />
        </Card>
      )}

      {currentStep === 3 && evaluationId && (
        <Card>
          <Result
            status="success"
            title="评测完成！"
            subTitle="AI 已完成对项目的全面评估"
            extra={[
              <Button
                type="primary"
                key="report"
                onClick={() => navigate(`/report/${evaluationId}`)}
              >
                查看评测报告
              </Button>,
              <Button key="new" onClick={() => setCurrentStep(0)}>
                发起新评测
              </Button>,
            ]}
          />
        </Card>
      )}
    </div>
  );
};

export default Evaluate;
