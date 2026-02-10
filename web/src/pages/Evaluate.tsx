import { useState } from 'react';
import { Card, Form, Input, Button, Checkbox, message, Steps, Result, Radio, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import { FolderOpenOutlined, RocketOutlined, ThunderboltOutlined, SearchOutlined } from '@ant-design/icons';
import { evaluationApi } from '../services/api';

const { TextArea } = Input;

const Evaluate = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [evaluationId, setEvaluationId] = useState<string | null>(null);

  const roleOptions = [
    { label: '👔 老板视角 (战略决策)', value: 'boss' },
    { label: '🏪 商户视角 (B2B客户)', value: 'merchant' },
    { label: '⚙️ 运营视角 (日常管理)', value: 'operator' },
    { label: '🏗️ 架构师视角 (技术深度)', value: 'architect' },
  ];

  const handleSubmit = async (values: {
    projectPath: string;
    projectName: string;
    roles: string[];
    context: string;
    depth: string;
  }) => {
    setLoading(true);
    setCurrentStep(1);

    try {
      const res = await evaluationApi.startEvaluation({
        projectPath: values.projectPath,
        projectName: values.projectName,
        roles: values.roles || ['boss', 'merchant', 'operator'],
        context: values.context || '',
        depth: values.depth || 'quick',
      });

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
              roles: ['boss', 'merchant', 'operator', 'architect'],
              projectPath: '/Users/hal/DDT-Monodt',
              projectName: 'DDT-Monodt',
              context: 'DDT+ 数字孪生仓库管理操作系统（Monorepo），包含 WMS 后端(Python FastAPI)、WMS 前端(React)、ControlPlane 智能体操作系统、TradeOS 合规接口等子服务。面向香港分销行业，提供事件驱动的仓库管理和AI辅助运营。',
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
              name="roles"
              label="评测角色"
              rules={[{ required: true, message: '请至少选择一个角色' }]}
            >
              <Checkbox.Group options={roleOptions} />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<RocketOutlined />}
                size="large"
                loading={loading}
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
