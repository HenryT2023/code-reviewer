import { useState, useEffect } from 'react';
import { Card, Row, Col, Button, Tag, List, Spin, Progress, Collapse, Typography, message, Statistic, Alert } from 'antd';
import { SyncOutlined, ExperimentOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { evolutionApi, ReflectionRecord, SynthesisRecord, EvolutionStats } from '../services/api';

const { Text, Paragraph } = Typography;

const Evolution = () => {
  const [stats, setStats] = useState<EvolutionStats | null>(null);
  const [reflections, setReflections] = useState<ReflectionRecord[]>([]);
  const [latestSynthesis, setLatestSynthesis] = useState<SynthesisRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, reflectionsRes, synthesisRes] = await Promise.all([
        evolutionApi.getStats(),
        evolutionApi.listReflections(),
        evolutionApi.getLatestSynthesis().catch(() => ({ data: null })),
      ]);
      setStats(statsRes.data);
      setReflections(reflectionsRes.data.reflections);
      setLatestSynthesis(synthesisRes.data);
    } catch (error) {
      console.error('Failed to load evolution data:', error);
    }
    setLoading(false);
  };

  const handleSynthesize = async () => {
    setSynthesizing(true);
    try {
      const res = await evolutionApi.triggerSynthesis();
      setLatestSynthesis(res.data);
      message.success('进化合成完成！');
      loadData();
    } catch (error) {
      console.error('Synthesis failed:', error);
      message.error('进化合成失败');
    }
    setSynthesizing(false);
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
    };
    return names[role] || role;
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <h2>🧬 角色自进化</h2>
      <p style={{ color: '#666', marginBottom: 24 }}>
        每次评测完成后，系统会自动对各角色的输出质量进行反思，积累改进建议。累积足够反馈后可触发进化合成，生成 Prompt 改进方案和新角色提议。
      </p>

      {/* Stats Overview */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="累积反思" value={stats?.reflectionCount || 0} suffix="次" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="进化合成" value={stats?.synthesisCount || 0} suffix="次" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="盲区发现" value={stats?.topBlindSpots?.length || 0} suffix="个" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="新角色提议" value={stats?.topNewRoleProposals?.length || 0} suffix="个" />
          </Card>
        </Col>
      </Row>

      {/* Synthesis Trigger */}
      {stats?.needsSynthesis && (
        <Alert
          type="info"
          showIcon
          message="建议触发进化合成"
          description={`已累积 ${stats.reflectionCount} 次反思，可以合成改进方案了。`}
          style={{ marginBottom: 24 }}
          action={
            <Button type="primary" icon={<ExperimentOutlined />} onClick={handleSynthesize} loading={synthesizing}>
              触发进化合成
            </Button>
          }
        />
      )}

      {!stats?.needsSynthesis && stats?.reflectionCount && stats.reflectionCount > 0 && (
        <div style={{ marginBottom: 24 }}>
          <Button icon={<SyncOutlined />} onClick={handleSynthesize} loading={synthesizing}>
            手动触发进化合成
          </Button>
        </div>
      )}

      {/* Role Quality Overview */}
      {stats?.averageRoleQuality && Object.keys(stats.averageRoleQuality).length > 0 && (
        <Card title="📊 角色平均质量评分" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            {Object.entries(stats.averageRoleQuality).map(([role, score]) => (
              <Col span={6} key={role} style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8 }}>{getRoleName(role)}</div>
                <Progress
                  percent={score}
                  strokeColor={score >= 80 ? '#52c41a' : score >= 60 ? '#faad14' : '#f5222d'}
                  format={p => `${p}分`}
                />
              </Col>
            ))}
          </Row>
        </Card>
      )}

      {/* Top Blind Spots */}
      {stats?.topBlindSpots && stats.topBlindSpots.length > 0 && (
        <Card title="🔍 常见盲区" style={{ marginBottom: 24 }}>
          <List
            size="small"
            dataSource={stats.topBlindSpots}
            renderItem={item => (
              <List.Item>
                <Tag color="orange">{item.spot}</Tag>
                <Text type="secondary">出现 {item.count} 次</Text>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Top New Role Proposals */}
      {stats?.topNewRoleProposals && stats.topNewRoleProposals.length > 0 && (
        <Card title="🆕 热门新角色提议" style={{ marginBottom: 24 }}>
          <List
            size="small"
            dataSource={stats.topNewRoleProposals}
            renderItem={item => (
              <List.Item>
                <Tag color="blue">{item.id}</Tag>
                <Text type="secondary">被提议 {item.count} 次</Text>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Latest Synthesis */}
      {latestSynthesis && (
        <Card title="🎯 最新进化合成结果" style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <Tag color="purple">版本: {latestSynthesis.version}</Tag>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              生成于: {new Date(latestSynthesis.generatedAt).toLocaleString('zh-CN')}
            </Text>
            {latestSynthesis.appliedAt && (
              <Tag color="green" icon={<CheckCircleOutlined />} style={{ marginLeft: 8 }}>
                已采纳
              </Tag>
            )}
          </div>

          {latestSynthesis.promptDiffs.length > 0 && (
            <Collapse
              items={latestSynthesis.promptDiffs.map(diff => ({
                key: diff.role,
                label: (
                  <span>
                    {getRoleName(diff.role)}
                    <Tag color="blue" style={{ marginLeft: 8 }}>置信度: {Math.round(diff.confidence * 100)}%</Tag>
                    <Text type="secondary" style={{ marginLeft: 8 }}>基于 {diff.evidenceCount} 次反馈</Text>
                  </span>
                ),
                children: (
                  <div>
                    {diff.suggestedAdditions.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ color: '#52c41a' }}>➕ 建议添加:</Text>
                        <List size="small" dataSource={diff.suggestedAdditions} renderItem={(item: string) => <List.Item>{item}</List.Item>} />
                      </div>
                    )}
                    {diff.suggestedRemovals.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <Text strong style={{ color: '#f5222d' }}>➖ 建议移除:</Text>
                        <List size="small" dataSource={diff.suggestedRemovals} renderItem={(item: string) => <List.Item>{item}</List.Item>} />
                      </div>
                    )}
                    {diff.rewrittenPrompt && (
                      <div>
                        <Text strong>📝 重写后的 Prompt:</Text>
                        <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 4, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
                          {diff.rewrittenPrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                ),
              }))}
              style={{ marginBottom: 16 }}
            />
          )}

          {latestSynthesis.newRoles.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Text strong>🆕 新角色定义:</Text>
              {latestSynthesis.newRoles.map(role => (
                <Card key={role.id} size="small" style={{ marginTop: 8 }} title={`${role.emoji} ${role.label} (${role.id})`}>
                  <Tag color={role.category === 'primary' ? 'blue' : 'green'}>{role.category}</Tag>
                  <Tag color="purple">置信度: {Math.round(role.confidence * 100)}%</Tag>
                  <Tag>被提议 {role.proposalCount} 次</Tag>
                  <Collapse
                    items={[
                      { key: 'standard', label: '标准模式 Prompt', children: <Paragraph copyable><pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{role.standardPrompt}</pre></Paragraph> },
                      { key: 'launch', label: 'Launch-Ready Prompt', children: <Paragraph copyable><pre style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{role.launchReadyPrompt}</pre></Paragraph> },
                    ]}
                    style={{ marginTop: 8 }}
                  />
                </Card>
              ))}
            </div>
          )}

          {latestSynthesis.retireCandidates.length > 0 && (
            <div>
              <Text strong style={{ color: '#f5222d' }}>⚠️ 退役候选:</Text>
              <List
                size="small"
                dataSource={latestSynthesis.retireCandidates}
                renderItem={item => (
                  <List.Item>
                    <Tag color="red">{getRoleName(item.role)}</Tag>
                    <Text type="secondary">{item.reason}</Text>
                  </List.Item>
                )}
              />
            </div>
          )}
        </Card>
      )}

      {/* Reflection History */}
      <Card title="📜 反思历史">
        {reflections.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
            暂无反思记录。运行一次评测后会自动生成。
          </div>
        ) : (
          <Collapse
            items={reflections.slice(0, 10).map((r, i) => ({
              key: r.id,
              label: (
                <span>
                  反思 #{reflections.length - i}
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    {new Date(r.timestamp).toLocaleString('zh-CN')}
                  </Text>
                  <Tag style={{ marginLeft: 8 }}>{r.roleAssessments.length} 角色</Tag>
                  {r.blindSpots.length > 0 && <Tag color="orange">{r.blindSpots.length} 盲区</Tag>}
                  {r.newRoleProposals.length > 0 && <Tag color="blue">{r.newRoleProposals.length} 新角色提议</Tag>}
                </span>
              ),
              children: (
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <Text strong>角色评估:</Text>
                    {r.roleAssessments.map(a => (
                      <Tag key={a.role} color={a.qualityScore >= 80 ? 'green' : a.qualityScore >= 60 ? 'orange' : 'red'} style={{ margin: 4 }}>
                        {getRoleName(a.role)}: {a.qualityScore}分
                      </Tag>
                    ))}
                  </div>
                  {r.blindSpots.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Text strong>盲区:</Text> {r.blindSpots.map((s, j) => <Tag key={j} color="orange" style={{ margin: 4 }}>{s}</Tag>)}
                    </div>
                  )}
                  {r.newRoleProposals.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Text strong>新角色提议:</Text> {r.newRoleProposals.map(p => <Tag key={p.id} color="blue" style={{ margin: 4 }}>{p.emoji} {p.label}</Tag>)}
                    </div>
                  )}
                  <div>
                    <Text strong>元观察:</Text> <Text type="secondary">{r.metaObservations}</Text>
                  </div>
                </div>
              ),
            }))}
          />
        )}
      </Card>
    </div>
  );
};

export default Evolution;
