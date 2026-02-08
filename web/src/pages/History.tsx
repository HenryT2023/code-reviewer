import { useState, useEffect } from 'react';
import { Table, Tag, Button, Popconfirm, message, Card } from 'antd';
import { useNavigate } from 'react-router-dom';
import { DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { evaluationApi, EvaluationRecord } from '../services/api';

const History = () => {
  const navigate = useNavigate();
  const [evaluations, setEvaluations] = useState<EvaluationRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadEvaluations();
  }, []);

  const loadEvaluations = async () => {
    setLoading(true);
    try {
      const res = await evaluationApi.listHistory(50);
      setEvaluations(res.data);
    } catch (error) {
      console.error('Failed to load evaluations:', error);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await evaluationApi.deleteEvaluation(id);
      message.success('删除成功');
      loadEvaluations();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'projectName',
      key: 'projectName',
    },
    {
      title: '项目路径',
      dataIndex: 'projectPath',
      key: 'projectPath',
      ellipsis: true,
    },
    {
      title: '评分',
      dataIndex: 'overallScore',
      key: 'overallScore',
      width: 100,
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
      width: 100,
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
      width: 180,
      render: (date: string) => new Date(date).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_: unknown, record: EvaluationRecord) => (
        <div>
          <Button
            type="link"
            icon={<EyeOutlined />}
            disabled={record.status !== 'completed'}
            onClick={() => navigate(`/report/${record.id}`)}
          >
            查看
          </Button>
          <Popconfirm
            title="确定删除此评测记录？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <Card title="评测历史记录">
      <Table
        columns={columns}
        dataSource={evaluations}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
      />
    </Card>
  );
};

export default History;
