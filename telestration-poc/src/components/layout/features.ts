import type { FeatureId, RailTab } from '../../types';

export type FeatureGroup = 'Player' | 'Tactic' | 'Action';

export type FeatureDef = {
  id: FeatureId;
  label: string;
  group: FeatureGroup;
  icon: string;
  implemented: boolean; // all effects are wired
  hint: string;
};

// Tile features in the Effect tab. Player-group tiles apply to a player chosen in the lower
// section (선수 지정 + P1~P4); the static court Circle lives separately under Tactic.
export const FEATURES: FeatureDef[] = [
  { id: 'follow-circle', label: '따라가기', group: 'Player', icon: '◎', implemented: true, hint: '선수를 따라다니는 바닥 원. 아래에서 선수를 선택해 적용합니다.' },
  { id: 'spotlight', label: 'Spotlight', group: 'Player', icon: '🔦', implemented: true, hint: '배경 어둡게 + 선수 강조. 아래에서 선수를 선택해 적용합니다.' },
  { id: 'pose', label: '폼 추적', group: 'Player', icon: '🤸', implemented: true, hint: '선수의 골격·관절 각도를 표시합니다. 아래에서 선수를 선택해 추가합니다.' },
  { id: 'circle', label: 'Circle', group: 'Tactic', icon: '◎', implemented: true, hint: '코트를 클릭해 바닥에 고정 헤일로(원)를 놓습니다.' },
  { id: 'path', label: 'Path', group: 'Tactic', icon: '↝', implemented: true, hint: '시작·끝 2점을 클릭해 화살표를 그립니다 (직선·맵/화면, 3D 포물선).' },
  { id: 'zone', label: 'Zone', group: 'Tactic', icon: '▰', implemented: true, hint: '코트를 3점 이상 클릭해 커버리지 존을 그립니다.' },
  { id: 'marker', label: 'Marker', group: 'Tactic', icon: '📍', implemented: true, hint: '코트를 클릭해 지점 마커를 놓습니다.' },
  { id: 'connector', label: 'Connector', group: 'Tactic', icon: '🔗', implemented: true, hint: '두 지점을 클릭해 잇는 선을 그립니다.' },
  { id: 'sector', label: 'Sector', group: 'Tactic', icon: '🪭', implemented: true, hint: '중심을 클릭 → 방향·거리 점을 클릭해 부채꼴(방사형)을 그립니다.' },
  { id: 'text', label: 'Text', group: 'Action', icon: '🅣', implemented: true, hint: '코트를 클릭해 텍스트 라벨을 놓습니다.' },
  { id: 'zoom-in', label: 'Zoom In', group: 'Action', icon: '🔍', implemented: true, hint: '코트를 클릭한 지점을 중심으로 화면을 확대합니다 (재생 중 punch-in).' },
  { id: 'slowmo', label: 'Slow-mo', group: 'Action', icon: '🐢', implemented: true, hint: '현재 위치에 배속 구간을 추가합니다. 재생이 그 구간에 들어가면 지정 배속으로.' },
  { id: 'pip', label: 'PiP', group: 'Action', icon: '🖼', implemented: true, hint: '다른 영상을 화면 위에 작은 창으로 겹칩니다 (학생 vs 프로 폼 비교 등). 파일을 고르면 재생헤드에 생겨요.' },
  // 'freehand' (펜) has no tile — armed from the COACH bar; kept here so a selected
  // pen stroke resolves to a label/editor. Filtered out of the tile grid.
  { id: 'freehand', label: '펜', group: 'Tactic', icon: '✏️', implemented: true, hint: '화면 위에 자유롭게 드래그해서 그립니다 (텔레스트레이터 펜).' },
];

export const FEATURE_GROUPS: FeatureGroup[] = ['Player', 'Tactic', 'Action'];

export const RAIL_TABS: { id: RailTab; label: string; icon: string }[] = [
  { id: 'effect', label: 'Effect', icon: '✨' },
  { id: 'narrative', label: 'Narrative', icon: '💬' },
];
