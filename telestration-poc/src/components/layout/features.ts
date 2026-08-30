import type { FeatureId, RailTab } from '../../types';

export type FeatureGroup = 'Player' | 'Tactic' | 'Action';

export type FeatureDef = {
  id: FeatureId;
  label: string;
  group: FeatureGroup;
  icon: string;
  implemented: boolean; // v1: only circle + zone are wired to real geometry
  hint: string;
};

// SportsBuddy Highlight features. Grouped exactly as in the paper's Fig. 1.
export const FEATURES: FeatureDef[] = [
  { id: 'circle', label: 'Circle', group: 'Player', icon: '◎', implemented: true, hint: '코트를 클릭해 바닥 헤일로(원)를 놓습니다.' },
  { id: 'spotlight', label: 'Spotlight', group: 'Player', icon: '🔦', implemented: false, hint: '배경 어둡게 + 선수 강조 → Player 탭에서 선수별 "스팟" 토글.' },
  { id: 'connector', label: 'Connector', group: 'Player', icon: '🔗', implemented: true, hint: '두 지점을 클릭해 잇는 선을 그립니다.' },
  { id: 'path', label: 'Path', group: 'Tactic', icon: '↝', implemented: true, hint: '코트를 여러 번 클릭해 화살표 경로를 그립니다.' },
  { id: 'zone', label: 'Zone', group: 'Tactic', icon: '▰', implemented: true, hint: '코트를 3점 이상 클릭해 커버리지 존을 그립니다.' },
  { id: 'marker', label: 'Marker', group: 'Tactic', icon: '📍', implemented: true, hint: '코트를 클릭해 지점 마커를 놓습니다.' },
  { id: 'text', label: 'Text', group: 'Action', icon: '🅣', implemented: true, hint: '코트를 클릭해 텍스트 라벨을 놓습니다.' },
  { id: 'zoom-in', label: 'Zoom In', group: 'Action', icon: '🔍', implemented: true, hint: '코트를 클릭한 지점을 중심으로 화면을 확대합니다 (재생 중 punch-in).' },
];

export const FEATURE_GROUPS: FeatureGroup[] = ['Player', 'Tactic', 'Action'];

export const RAIL_TABS: { id: RailTab; label: string; icon: string }[] = [
  { id: 'media', label: 'Media', icon: '🎬' },
  { id: 'court', label: 'Court', icon: '🎾' },
  { id: 'player', label: 'Player', icon: '🏃' },
  { id: 'highlight', label: 'Highlight', icon: '✨' },
  { id: 'narrative', label: 'Narrative', icon: '💬' },
];
