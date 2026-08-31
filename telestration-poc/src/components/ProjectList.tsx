import { useState } from 'react';
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
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const create = () => { if (name.trim()) { onCreate(name.trim()); setName(''); } };

  return (
    <div className="projects-screen">
      <div className="projects-inner">
        <div className="projects-head">
          <h1>🎾 Tennis Telestration</h1>
          <p>프로젝트를 열거나 새로 만드세요. 프로젝트마다 코트 보정과 효과가 저장됩니다.</p>
        </div>

        <div className="new-project">
          <input
            type="text"
            placeholder="새 프로젝트 이름 (예: 1강 자료화면)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            autoFocus
          />
          <button className="btn primary" onClick={create} disabled={!name.trim()}>+ 새 프로젝트</button>
        </div>

        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.id} className="project-card" onClick={() => onOpen(p)} title="열기">
              <div className="pc-thumb">🎬</div>
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
          {projects.length === 0 && <div className="pc-empty">아직 프로젝트가 없습니다. 위에서 새로 만드세요.</div>}
        </div>
      </div>
    </div>
  );
}
