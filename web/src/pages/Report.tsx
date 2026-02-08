import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Row, Col, Tabs, Tag, List, Spin, Button, Descriptions, Progress } from 'antd';
import { ArrowLeftOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { evaluationApi, EvaluationRecord } from '../services/api';

const Report = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [evaluation, setEvaluation] = useState<EvaluationRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadEvaluation(id);
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
    const details = role.details || {};
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

  const tabItems = evaluation.roleEvaluations?.map(role => ({
    key: role.role,
    label: getRoleName(role.role),
    children: renderRoleTab(role),
  })) || [];

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
