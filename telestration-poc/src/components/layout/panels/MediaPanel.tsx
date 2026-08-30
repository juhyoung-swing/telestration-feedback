import { useRef } from 'react';

export function MediaPanel({
  videoName,
  dims,
  onLoadFile,
}: {
  videoName: string;
  dims: { w: number; h: number } | null;
  onLoadFile: (f: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="panel">
      <div className="panel-title">Media · 영상</div>
      <p className="panel-desc">고정 카메라 테니스 영상을 불러옵니다. 기본 클립이 자동 로드돼 있습니다.</p>

      <button className="btn primary block" onClick={() => fileRef.current?.click()}>MP4 불러오기</button>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadFile(f);
          e.target.value = '';
        }}
      />

      <div className="panel-divider" />
      <div className="kv"><span>현재</span><b>{videoName}</b></div>
      <div className="kv"><span>해상도</span><b>{dims ? `${dims.w}×${dims.h}` : '로딩…'}</b></div>
    </div>
  );
}
