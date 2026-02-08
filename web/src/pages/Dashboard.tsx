import { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Button, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PlayCircleOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { evaluationApi, EvaluationRecord } from '../services/api';

const Dashboard = () => {
  const navigate = useNavigate();
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadEvaluations();
  }, []);

  const loadEvaluations = async () => {
    setLoading(true);
    try {
      const res = await evaluationApi.listHistory(10);
      setEvaluations(res.data);
    } catch (error) {
      console.error('Failed to load evaluations:', error);
    }
    setLoading(false);
  };

  const completedCount = evaluations.filter(e => e.status === 'completed').length;
  const avgScore = evaluations.filter(e => e.overallScore).reduce((sum, e) => sum + (e.overallScore || 0), 0) / (completedCount || 1);

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'projectName',
      key: 'projectName',
    },
    {
      title: '评分',
      dataIndex: 'overallScore',
      key: 'overallScore',
      render: (score: number | null) => score ? (
        <Tag color={score >= 80 ? 'green' : score >= 60 ? 'orange' : 'red'}>
          {score} 分
        </Tag>
      ) : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          pending: { color: 'default', text: '等待中' },
          analyzing: { color: 'processing', text: '分析中' },
          evaluating: { color: 'processing', text: '评测中' },
          completed: { color: 'success', text: '已完成' },
          failed: { color: 'error', text: '失败' },
        };
        const { color, text } = statusMap[status] || { color: 'default', text: status };
        return <Tag color={color}>{text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: EvaluationRecord) => (
        <Button
          type="link"
          disabled={record.status !== 'completed'}
          onClick={() => navigate(`/report/${record.id}`)}
        >
          查看报告
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总评测数"
              value={evaluations.length}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已完成"
              value={completedCount}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="平均评分"
              value={avgScore.toFixed(1)}
              suffix="分"
              valueStyle={{ color: avgScore >= 70 ? '#3f8600' : '#cf1322' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              size="large"
              block
              onClick={() => navigate('/evaluate')}
            >
              发起新评测
            </Button>
          </Card>
        </Col>
      </Row>

      <Card title="最近评测">
        {evaluations.length > 0 ? (
          <Table
            columns={columns}
            dataSource={evaluations}
            rowKey="id"
            loading={loading}
            pagination={false}
          />
        ) : (
          <Empty description="暂无评测记录">
            <Button type="primary" onClick={() => navigate('/evaluate')}>
              立即开始
            </Button>
          </Empty>
        )}
      </Card>
    </div>
  );
};

export default Dashboard;
