import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import Dashboard from './pages/Dashboard';
import Evaluate from './pages/Evaluate';
import Report from './pages/Report';
import History from './pages/History';

const { Header, Sider, Content } = Layout;

function AppLayout() {
  const location = useLocation();

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">仪表盘</Link> },
    { key: '/evaluate', icon: <PlayCircleOutlined />, label: <Link to="/evaluate">发起评测</Link> },
    { key: '/history', icon: <HistoryOutlined />, label: <Link to="/history">历史记录</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={200}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>🤖 CodeReviewer</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #f0f0f0' }}>
          <h2 style={{ margin: 0, lineHeight: '64px' }}>AI 项目评测系统</h2>
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/evaluate" element={<Evaluate />} />
            <Route path="/report/:id" element={<Report />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;
