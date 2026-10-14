import { useNavigate } from 'react-router-dom';

/** 自有 404 页（已去平台化，不再使用模板的 NotFoundRender）。 */
const NotFound = () => {
  const navigate = useNavigate();
  return (
    <div style={{ padding: 60, textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>页面不存在（404）</h1>
      <p style={{ color: '#666', fontSize: 14 }}>一木·YIMU AI 视频创作平台</p>
      <button
        onClick={() => navigate('/')}
        style={{ marginTop: 16, padding: '8px 20px', borderRadius: 8, border: '1px solid #ddd', cursor: 'pointer' }}
      >
        回首页
      </button>
    </div>
  );
};

export default NotFound;
