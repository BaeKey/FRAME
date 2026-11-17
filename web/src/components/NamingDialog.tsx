import { useEffect, useState } from 'react';
import type { NamingRule } from '../types';
import { createApiClient } from '../api/client';
import { handleSessionUnauthorized } from '../store/session';

const api = createApiClient(handleSessionUnauthorized);

export function NamingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rules, setRules] = useState<NamingRule[]>([]);
  const [filename, setFilename] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setMessage('');
    void api.getNamingRules().then(data => setRules(data.rules)).catch(e => setError(e.message));
  }, [open]);

  if (!open) return null;

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.previewNamingRule(rules, filename);
      const type = { image: '图片', video: '视频', unknown: '其他格式' }[data.type] || data.type;
      setMessage(`${data.matched ? '匹配成功' : '未匹配'} · 分组：${data.group} · ${type}${data.timestamp ? ` · ${data.timestamp}` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败');
    } finally {
      setBusy(false);
    }
  };

  return <div className="viewer-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="dialog naming-dialog" role="dialog" aria-modal="true" aria-labelledby="naming-title">
      <header className="dialog-header">
        <div><span className="section-kicker">全库分类设置</span><h2 id="naming-title">命名规则</h2></div>
        <button className="icon-button" aria-label="关闭命名规则" onClick={onClose}>×</button>
      </header>
      <div className="dialog-body">
        <p className="muted">规则按顺序匹配，首个有效匹配用于分组。不匹配的文件放入“其他”。模板必填 {'{group}'} 和 {'{ext}'}，可选 {'{date}'}、{'{time}'}、{'{name}'}。规则在服务端配置文件的 <code>index.naming_rules</code> 中修改，修改后需重启服务。</p>
        <div className="naming-rules">{rules.map((rule, index) =>
          <fieldset className="rule-card" key={`${index}-${rule.name}`}>
            <legend>规则 {index + 1}</legend>
            <label><input type="checkbox" checked={rule.enabled} readOnly disabled /> 启用</label>
            <label>规则名称<input value={rule.name} readOnly /></label>
            <label>命名模板<input value={rule.template} readOnly /></label>
          </fieldset>
        )}</div>
        <section className="rule-preview">
          <label htmlFor="rule-filename">测试文件名</label>
          <input id="rule-filename" value={filename} onChange={e => setFilename(e.target.value)} placeholder="旅行_20261116-120000.jpg" />
          <button className="secondary" disabled={busy || !rules.length || !filename} onClick={() => void preview()}>测试配置规则</button>
          <p role="status">{message}</p>
        </section>
        <p className="inline-error" role="alert">{error}</p>
      </div>
      <footer className="dialog-footer"><button className="secondary" onClick={onClose}>关闭</button></footer>
    </section>
  </div>;
}
