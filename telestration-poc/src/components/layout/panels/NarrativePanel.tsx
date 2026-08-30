export function NarrativePanel() {
  return (
    <div className="panel">
      <div className="panel-title">Narrative · 자막</div>
      <p className="panel-desc">캡션/자막 트랙. 이번 UI 단계에서는 자리만 잡아둔 상태입니다.</p>
      <div className="soon-note">자막 입력 · AI 캡션은 곧 지원됩니다.</div>
      <textarea className="caption-stub" placeholder="자막을 입력… (미리보기용, 저장 안 됨)" rows={3} />
      <button className="btn primary block" disabled>자막 추가</button>
    </div>
  );
}
