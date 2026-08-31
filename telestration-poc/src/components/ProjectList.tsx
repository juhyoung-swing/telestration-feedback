import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Project } from '../lib/projects';

const fmtDate = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function ProjectList({
  projects,
  onOpen,
  onCreate,
  onDelete,
}: {
  projects: Project[];
  onOpen: (p: Project) => void;
  onCreate: (name: string, file: File | null) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<'file' | 'sample' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');

  const reset = () => { setCreating(false); setSource(null); setFile(null); setName(''); };
  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setSource('file'); if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, '')); }
  };
  const useSample = () => { setSource('sample'); setFile(null); if (!name.trim()) setName('court'); };
  const canCreate = source !== null && name.trim().length > 0;
  const submit = () => { if (canCreate) { onCreate(name.trim(), source === 'file' ? file : null); reset(); } };

  return (
    <div className="projects-screen">
      <div className="projects-inner">
        <div className="projects-head">
          <h1>🎾 Tennis Telestration</h1>
        </div>

        <div className="projects-bar">
          <span className="projects-count">프로젝트 {projects.length}</span>
          <button className="btn primary" onClick={() => setCreating(true)}>+ 새 프로젝트</button>
        </div>

        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.id} className="project-card" onClick={() => onOpen(p)} title="열기">
              <div className="pc-thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : '🎬'}</div>
              <div className="pc-body">
                <div className="pc-name">{p.name}</div>
                <div className="pc-meta">{p.videoName} · {fmtDate(p.updatedAt)}</div>
                <div className="pc-badges">
                  <span className={p.corners ? 'ok' : 'muted'}>보정 {p.corners ? '✓' : '—'}</span>
                  <span className="muted">효과 {p.overlays.length}</span>
                </div>
              </div>
              <button
                className="pc-del"
                title="삭제"
                onClick={(e) => { e.stopPropagation(); if (confirm(`"${p.name}" 프로젝트를 삭제할까요?`)) onDelete(p.id); }}
              >🗑</button>
            </div>
          ))}
          {projects.length === 0 && <div className="pc-empty">아직 프로젝트가 없습니다. "+ 새 프로젝트"로 시작하세요.</div>}
        </div>
      </div>

      {creating && (
        <div className="modal-backdrop" onMouseDown={reset}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">새 프로젝트</div>
            <div className="modal-body">
              <div className="field">
                <label>영상</label>
                <label className={`file-drop ${source === 'file' ? 'has' : ''}`}>
                  <input type="file" accept="video/*" hidden onChange={pickFile} />
                  {file ? `🎬 ${file.name}` : '클릭해서 영상 파일 선택'}
                </label>
                <button
                  type="button"
                  className={`btn subtle sm block ${source === 'sample' ? 'active' : ''}`}
                  onClick={useSample}
                >또는 샘플 영상 사용 (court.mp4)</button>
              </div>
              <div className="field">
                <label>프로젝트 이름</label>
                <input
                  type="text" placeholder="예: 1강 자료화면" value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={reset}>취소</button>
              <button className="btn primary" onClick={submit} disabled={!canCreate}>만들기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
