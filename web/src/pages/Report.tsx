import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Row, Col, Tabs, Tag, List, Spin, Button, Descriptions, Progress, Typography, Alert } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { evaluationApi, evolutionApi, EvaluationRecord, ReflectionRecord } from '../services/api';

const { Text } = Typography;

const Report = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [evaluation, setEvaluation] = useState<EvaluationRecord | null>(null);
  const [reflection, setReflection] = useState<ReflectionRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadEvaluation(id);
      loadReflection(id);
    }
  }, [id]);

  const loadEvaluation = async (evalId: string) => {
    try {
      const res = await evaluationApi.getEvaluation(evalId);
      setEvaluation(res.data);
    } catch (error) {
      console.error('Failed to load evaluation:', error);
    }
    setLoading(false);
  };

  const loadReflection = async (evalId: string) => {
    try {
      const res = await evolutionApi.getReflection(evalId);
      setReflection(res.data);
    } catch {
      // Reflection may not exist yet
    }
  };

  const getRadarOption = () => {
    if (!evaluation?.roleEvaluations) return {};

    const roles = evaluation.roleEvaluations;
    const indicators = [
      { name: '功能完整性', max: 100 },
      { name: '用户体验', max: 100 },
      { name: '技术架构', max: 100 },
      { name: '业务价值', max: 100 },
      { name: '运营效率', max: 100 },
    ];

    return {
      tooltip: {},
      legend: {
        data: roles.map(r => getRoleName(r.role)),
        bottom: 0,
      },
      radar: {
        indicator: indicators,
        radius: '65%',
      },
      series: [{
        type: 'radar',
        data: roles.map(r => ({
          name: getRoleName(r.role),
          value: getRadarValues(r.details),
        })),
      }],
    };
  };

  const getRoleName = (role: string) => {
    const names: Record<string, string> = {
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
      _debate: '🔴 对喷摘要',
      _orchestrator: '🎯 Launch-Ready 报告',
    };
    return names[role] || role;
  };

  const getRadarValues = (details: Record<string, unknown> | null): number[] => {
    if (!details || !details.dimensions) return [70, 70, 70, 70, 70];
    const dims = details.dimensions as Record<string, { score?: number }>;
    const values = Object.values(dims).map(d => d?.score || 70);
    while (values.length < 5) values.push(70);
    return values.slice(0, 5);
  };

  const renderRoleTab = (role: { role: string; score: number | null; summary: string | null; details: Record<string, unknown> | null }) => {
    const details = (role.details || {}) as Record<string, any>;
    const dimensions = (details.dimensions || {}) as Record<string, { score?: number; comment?: string }>;

    return (
      <div>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <Card>
              <div style={{ textAlign: 'center' }}>
                <Progress
                  type="circle"
                  percent={role.score || 0}
                  format={percent => `${percent}分`}
                  strokeColor={
                    (role.score || 0) >= 80 ? '#52c41a' :
                    (role.score || 0) >= 60 ? '#faad14' : '#f5222d'
                  }
                />
                <div style={{ marginTop: 16, fontSize: 16 }}>{getRoleName(role.role)}</div>
              </div>
            </Card>
          </Col>
          <Col span={16}>
            <Card title="评测摘要">
              <p>{role.summary || '暂无摘要'}</p>
            </Card>
          </Col>
        </Row>

        <Card title="维度评分" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            {Object.entries(dimensions).map(([key, dim]) => (
              <Col span={8} key={key} style={{ marginBottom: 16 }}>
                <Card size="small">
                  <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{key}</div>
                  <Progress percent={dim?.score || 0} size="small" />
                  <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                    {dim?.comment || ''}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>

        {details.opportunities && (
          <Card title="机会点" style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={details.opportunities as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          </Card>
        )}

        {details.risks && (
          <Card title="风险点" style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={details.risks as string[]}
              renderItem={(item: string) => <List.Item><Tag color="red">{item}</Tag></List.Item>}
            />
          </Card>
        )}

        {details.recommendations && (
          <Card title="改进建议">
            <List
              size="small"
              dataSource={details.recommendations as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          </Card>
        )}

        {details.painPoints && (
          <Card title="痛点" style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={details.painPoints as string[]}
              renderItem={(item: string) => <List.Item><Tag color="orange">{item}</Tag></List.Item>}
            />
          </Card>
        )}

        {details.suggestions && (
          <Card title="建议">
            <List
              size="small"
              dataSource={details.suggestions as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          </Card>
        )}

        {details.gaps && (
          <Card title="功能缺口" style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={details.gaps as string[]}
              renderItem={(item: string) => <List.Item><Tag color="blue">{item}</Tag></List.Item>}
            />
          </Card>
        )}

        {details.improvements && (
          <Card title="改进建议">
            <List
              size="small"
              dataSource={details.improvements as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          </Card>
        )}
      </div>
    );
  };

  const renderRuntimeTab = () => {
    // Get runtime stages from evaluation record
    const runtimeStages = evaluation?.runtimeStages || [];

    if (!runtimeStages || runtimeStages.length === 0) {
      return (
        <Alert
          type="info"
          message="无运行时评测数据"
          description="本次评测未包含动态/UI评测。如需运行时评测，请在发起评测时选择「动态评测」或「完整评测」。"
        />
      );
    }

    const getStageIcon = (status: string) => {
      switch (status) {
        case 'passed': return '✅';
        case 'failed': return '❌';
        case 'skipped': return '⏭️';
        default: return '⚪';
      }
    };

    const getStageColor = (status: string) => {
      switch (status) {
        case 'passed': return 'green';
        case 'failed': return 'red';
        case 'skipped': return 'default';
        default: return 'blue';
      }
    };

    const stageTitles: Record<string, string> = {
      startup: '🚀 应用启动',
      health: '💓 健康检查',
      api: '🔌 API 测试',
      ui: '🎭 UI 评测',
    };

    return (
      <div>
        <Card title="运行时评测概览" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            {runtimeStages.map((stage, index) => (
              <Col span={6} key={index}>
                <Card size="small">
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>
                      {getStageIcon(stage.status)}
                    </div>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                      {stageTitles[stage.stage] || stage.stage}
                    </div>
                    <Tag color={getStageColor(stage.status)}>
                      {stage.status}
                    </Tag>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                      {stage.duration_ms}ms
                    </div>
                    {stage.score !== undefined && (
                      <Progress 
                        percent={stage.score} 
                        size="small" 
                        style={{ marginTop: 8 }}
                        strokeColor={stage.score >= 80 ? '#52c41a' : stage.score >= 60 ? '#faad14' : '#f5222d'}
                      />
                    )}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>

        {runtimeStages.some(s => s.errors && s.errors.length > 0) && (
          <Card title="❌ 错误日志" style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={runtimeStages.flatMap(s => (s.errors || []).map(e => ({ stage: s.stage, error: e })))}
              renderItem={(item: { stage: string; error: string }) => (
                <List.Item>
                  <Tag color="red">{stageTitles[item.stage] || item.stage}</Tag>
                  <Text type="danger">{item.error}</Text>
                </List.Item>
              )}
            />
          </Card>
        )}

        {runtimeStages.filter(s => s.stage === 'api' && s.details).map((stage, index) => {
          const apiDetails = stage.details as { results?: Array<{ endpoint: string; method: string; status: number; passed: boolean }> };
          if (!apiDetails.results) return null;
          return (
            <Card key={index} title="🔌 API 测试详情" style={{ marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <th style={{ padding: 8, textAlign: 'left' }}>端点</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>方法</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>状态码</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {apiDetails.results.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: 8 }}>{r.endpoint}</td>
                      <td style={{ padding: 8 }}><Tag>{r.method}</Tag></td>
                      <td style={{ padding: 8 }}>{r.status}</td>
                      <td style={{ padding: 8 }}>
                        <Tag color={r.passed ? 'green' : 'red'}>
                          {r.passed ? '通过' : '失败'}
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}

        {runtimeStages.filter(s => s.stage === 'ui' && s.details).map((stage, index) => {
          const uiDetails = stage.details as { flows?: Array<{ name: string; passed: boolean; steps?: Array<{ action: string; passed: boolean }> }> };
          if (!uiDetails.flows) return null;
          return (
            <Card key={index} title="🎭 UI 测试详情" style={{ marginBottom: 16 }}>
              {uiDetails.flows.map((flow, fi) => (
                <Card key={fi} size="small" style={{ marginBottom: 8 }} title={
                  <span>
                    {flow.name}
                    <Tag color={flow.passed ? 'green' : 'red'} style={{ marginLeft: 8 }}>
                      {flow.passed ? '通过' : '失败'}
                    </Tag>
                  </span>
                }>
                  {flow.steps && (
                    <List
                      size="small"
                      dataSource={flow.steps}
                      renderItem={(step: { action: string; passed: boolean }) => (
                        <List.Item>
                          {step.passed ? '✅' : '❌'} {step.action}
                        </List.Item>
                      )}
                    />
                  )}
                </Card>
              ))}
            </Card>
          );
        })}
      </div>
    );
  };

  const renderReflectionTab = () => {
    if (!reflection) {
      return (
        <Alert
          type="info"
          message="反思数据尚未生成"
          description="评测完成后会自动运行角色自进化反思，请稍后刷新查看。"
        />
      );
    }

    return (
      <div>
        <Card title="📊 角色质量评估" style={{ marginBottom: 16 }}>
          {reflection.roleAssessments.map(a => (
            <Card key={a.role} size="small" style={{ marginBottom: 8 }} title={
              <span>
                {getRoleName(a.role)}
                <Tag color={a.qualityScore >= 80 ? 'green' : a.qualityScore >= 60 ? 'orange' : 'red'} style={{ marginLeft: 8 }}>
                  质量: {a.qualityScore}分
                </Tag>
              </span>
            }>
              <Row gutter={16}>
                <Col span={12}>
                  <Text strong style={{ color: '#52c41a' }}>✅ 优点</Text>
                  <List size="small" dataSource={a.strengths} renderItem={(item: string) => <List.Item>{item}</List.Item>} />
                </Col>
                <Col span={12}>
                  <Text strong style={{ color: '#f5222d' }}>❌ 缺点</Text>
                  <List size="small" dataSource={a.weaknesses} renderItem={(item: string) => <List.Item>{item}</List.Item>} />
                </Col>
              </Row>
              {a.promptSuggestions.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text strong style={{ color: '#1890ff' }}>💡 Prompt 改进建议</Text>
                  <List size="small" dataSource={a.promptSuggestions} renderItem={(item: string) => <List.Item>{item}</List.Item>} />
                </div>
              )}
              {a.redundancyWith.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Text type="warning">⚠️ 与以下角色有重复: {a.redundancyWith.join(', ')}</Text>
                </div>
              )}
            </Card>
          ))}
        </Card>

        {reflection.blindSpots.length > 0 && (
          <Card title="🔍 评测盲区" style={{ marginBottom: 16 }}>
            <List
              size="small"
              dataSource={reflection.blindSpots}
              renderItem={(item: string) => (
                <List.Item>
                  <Tag color="orange">{item}</Tag>
                </List.Item>
              )}
            />
          </Card>
        )}

        {reflection.newRoleProposals.length > 0 && (
          <Card title="🆕 新角色提议" style={{ marginBottom: 16 }}>
            {reflection.newRoleProposals.map(p => (
              <Card key={p.id} size="small" style={{ marginBottom: 8 }} title={`${p.emoji} ${p.label} (${p.id})`}>
                <p><Text strong>提议理由:</Text> {p.rationale}</p>
                <p><Text strong>Prompt 草稿:</Text></p>
                <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4, whiteSpace: 'pre-wrap' }}>
                  {p.draftPromptSketch}
                </pre>
              </Card>
            ))}
          </Card>
        )}

        <Card title="📝 元观察">
          <p>{reflection.metaObservations}</p>
        </Card>
      </div>
    );
  };

  const renderDebateTab = (role: { role: string; score: number | null; summary: string | null; details: Record<string, unknown> | null }) => {
    const d = role.details || {} as Record<string, unknown>;
    const consensus = (d.consensus || []) as string[];
    const disputes = (d.disputes || []) as Array<{ topic: string; support?: string[]; oppose?: string[]; resolution?: string }>;
    const unresolved = (d.unresolved || []) as string[];

    return (
      <div>
        <Card title="📋 对喷摘要" style={{ marginBottom: 16 }}>
          <p>{role.summary || '暂无摘要'}</p>
        </Card>

        {consensus.length > 0 && (
          <Card title="✅ 共识" style={{ marginBottom: 16 }}>
            <List size="small" dataSource={consensus} renderItem={(item: string) => (
              <List.Item><Tag color="green">{item}</Tag></List.Item>
            )} />
          </Card>
        )}

        {disputes.length > 0 && (
          <Card title="⚔️ 争议" style={{ marginBottom: 16 }}>
            {disputes.map((disp, i) => (
              <Card key={i} size="small" style={{ marginBottom: 8 }} title={disp.topic}>
                {disp.support?.length ? (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="success" strong>支持：</Text>
                    {disp.support.map((s, j) => <Tag key={j} color="green" style={{ marginBottom: 4 }}>{s}</Tag>)}
                  </div>
                ) : null}
                {disp.oppose?.length ? (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="danger" strong>反对：</Text>
                    {disp.oppose.map((s, j) => <Tag key={j} color="red" style={{ marginBottom: 4 }}>{s}</Tag>)}
                  </div>
                ) : null}
                {disp.resolution && (
                  <div><Text strong>→ 裁决：</Text> {disp.resolution}</div>
                )}
              </Card>
            ))}
          </Card>
        )}

        {unresolved.length > 0 && (
          <Card title="❓ 未解决">
            <List size="small" dataSource={unresolved} renderItem={(item: string) => (
              <List.Item><Tag color="orange">{item}</Tag></List.Item>
            )} />
          </Card>
        )}
      </div>
    );
  };

  const renderOrchestratorTab = (role: { role: string; score: number | null; summary: string | null; details: Record<string, unknown> | null }) => {
    const d = role.details || {} as Record<string, unknown>;
    const verdict = (d.launch_verdict as string) || 'N/A';
    const score = (d.overall_score as number) || 0;
    const conditions = (d.verdict_conditions || []) as string[];
    const sections = (d.sections || {}) as Record<string, Record<string, unknown>>;
    const actionItems = (d.action_items || []) as Array<Record<string, unknown>>;

    const verdictColor = verdict === 'GO' ? '#52c41a' : verdict === 'NO-GO' ? '#f5222d' : '#faad14';

    const sectionTitles: Record<string, string> = {
      A_launch_definition: 'A. Launch 定义与验收标准',
      B_icp_and_market: 'B. ICP 与市场',
      C_core_transaction: 'C. 核心交易与价值主张',
      D_release_scope: 'D. Release Scope',
      E_debate_summary: 'E. 专家对喷摘要',
      F_experiments: 'F. 验证实验',
      G_instrumentation: 'G. 数据埋点与监控',
      H_roadmap: 'H. 迭代路线图',
      I_risks: 'I. 风险登记表',
      J_pricing: 'J. 定价与商业化',
    };

    return (
      <div>
        <Card style={{ marginBottom: 16 }}>
          <Row gutter={16} align="middle">
            <Col span={6} style={{ textAlign: 'center' }}>
              <Progress
                type="circle"
                percent={score}
                format={() => `${score}`}
                strokeColor={verdictColor}
              />
            </Col>
            <Col span={18}>
              <div style={{ fontSize: 24, fontWeight: 'bold', color: verdictColor, marginBottom: 8 }}>
                Launch Verdict: {verdict}
              </div>
              <p>{role.summary || ''}</p>
              {conditions.length > 0 && (
                <div>
                  <Text strong>前提条件：</Text>
                  <ul style={{ margin: '4px 0' }}>
                    {conditions.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
            </Col>
          </Row>
        </Card>

        {Object.entries(sectionTitles).map(([key, title]) => {
          const section = sections[key];
          if (!section) return null;
          return (
            <Card key={key} title={title} size="small" style={{ marginBottom: 12 }}>
              <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(section, null, 2)}
              </pre>
            </Card>
          );
        })}

        {actionItems.length > 0 && (
          <Card title="📝 Action Items" style={{ marginBottom: 16 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafa', borderBottom: '2px solid #e8e8e8' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>ID</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>任务</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>优先级</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>负责角色</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>工时</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>验收标准</th>
                  </tr>
                </thead>
                <tbody>
                  {actionItems.map((a, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e8e8e8' }}>
                      <td style={{ padding: '8px 12px' }}>{String(a.id || '-')}</td>
                      <td style={{ padding: '8px 12px' }}>{String(a.task || '-')}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <Tag color={a.priority === 'P0' ? 'red' : a.priority === 'P1' ? 'orange' : 'blue'}>
                          {String(a.priority || '-')}
                        </Tag>
                      </td>
                      <td style={{ padding: '8px 12px' }}>{String(a.owner_role || '-')}</td>
                      <td style={{ padding: '8px 12px' }}>{a.effort_hours ? `${a.effort_hours}h` : '-'}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12 }}>{String(a.acceptance_criteria || '-')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!evaluation) {
    return <div>评测记录不存在</div>;
  }

  const regularRoles = evaluation.roleEvaluations?.filter(r => !r.role.startsWith('_')) || [];
  const debateRole = evaluation.roleEvaluations?.find(r => r.role === '_debate');
  const orchestratorRole = evaluation.roleEvaluations?.find(r => r.role === '_orchestrator');

  const tabItems = [
    {
      key: '_runtime',
      label: '🚀 运行时评测',
      children: renderRuntimeTab(),
    },
    ...regularRoles.map(role => ({
      key: role.role,
      label: getRoleName(role.role),
      children: renderRoleTab(role),
    })),
    ...(debateRole ? [{
      key: '_debate',
      label: '🔴 对喷摘要',
      children: renderDebateTab(debateRole),
    }] : []),
    ...(orchestratorRole ? [{
      key: '_orchestrator',
      label: '🎯 Launch-Ready',
      children: renderOrchestratorTab(orchestratorRole),
    }] : []),
    {
      key: '_reflection',
      label: '🧬 角色反思',
      children: renderReflectionTab(),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(-1)}
        >
          返回
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => window.open(`/api/export/markdown/${id}`, '_blank')}
        >
          导出 Markdown
        </Button>
        <Button
          icon={<DownloadOutlined />}
          onClick={() => window.open(`/api/export/json/${id}`, '_blank')}
        >
          导出 JSON
        </Button>
      </div>

      <Card style={{ marginBottom: 24 }}>
        <Row gutter={24} align="middle">
          <Col span={6} style={{ textAlign: 'center' }}>
            <Progress
              type="dashboard"
              percent={evaluation.overallScore || 0}
              format={percent => (
                <div>
                  <div style={{ fontSize: 32, fontWeight: 'bold' }}>{percent}</div>
                  <div style={{ fontSize: 14, color: '#666' }}>总评分</div>
                </div>
              )}
              strokeColor={
                (evaluation.overallScore || 0) >= 80 ? '#52c41a' :
                (evaluation.overallScore || 0) >= 60 ? '#faad14' : '#f5222d'
              }
              size={180}
            />
          </Col>
          <Col span={18}>
            <Descriptions title={evaluation.projectName} column={2}>
              <Descriptions.Item label="项目路径">{evaluation.projectPath}</Descriptions.Item>
              <Descriptions.Item label="评测时间">
                {new Date(evaluation.createdAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
              <Descriptions.Item label="业务背景" span={2}>
                {evaluation.context || '未提供'}
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      <Row gutter={24}>
        <Col span={12}>
          <Card title="多角色评分雷达图">
            <ReactECharts option={getRadarOption()} style={{ height: 350 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="角色评分对比">
            {evaluation.roleEvaluations?.map(role => (
              <div key={role.role} style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8 }}>
                  {getRoleName(role.role)}
                  <Tag color={
                    (role.score || 0) >= 80 ? 'green' :
                    (role.score || 0) >= 60 ? 'orange' : 'red'
                  } style={{ marginLeft: 8 }}>
                    {role.score} 分
                  </Tag>
                </div>
                <Progress
                  percent={role.score || 0}
                  strokeColor={
                    (role.score || 0) >= 80 ? '#52c41a' :
                    (role.score || 0) >= 60 ? '#faad14' : '#f5222d'
                  }
                />
              </div>
            ))}
          </Card>
        </Col>
      </Row>

      <Card title="详细评测报告" style={{ marginTop: 24 }}>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
};

export default Report;
