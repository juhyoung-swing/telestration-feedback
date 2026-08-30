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
  { id: 'spotlight', label: 'Spotlight', group: 'Player', icon: '🔦', implemented: false, hint: '선수를 강조하는 스포트라이트. (곧 지원)' },
  { id: 'connector', label: 'Connector', group: 'Player', icon: '🔗', implemented: false, hint: '두 지점을 잇는 커넥터. (곧 지원)' },
  { id: 'path', label: 'Path', group: 'Tactic', icon: '↝', implemented: false, hint: '이동 경로 화살표. (곧 지원)' },
  { id: 'zone', label: 'Zone', group: 'Tactic', icon: '▰', implemented: true, hint: '코트를 3점 이상 클릭해 커버리지 존을 그립니다.' },
  { id: 'marker', label: 'Marker', group: 'Tactic', icon: '📍', implemented: false, hint: '지점 마커. (곧 지원)' },
  { id: 'zoom-in', label: 'Zoom In', group: 'Action', icon: '🔍', implemented: false, hint: '화면 확대 액션. (곧 지원)' },
];

export const FEATURE_GROUPS: FeatureGroup[] = ['Player', 'Tactic', 'Action'];

export const RAIL_TABS: { id: RailTab; label: string; icon: string }[] = [
  { id: 'media', label: 'Media', icon: '🎬' },
  { id: 'court', label: 'Court', icon: '🎾' },
  { id: 'player', label: 'Player', icon: '🏃' },
  { id: 'highlight', label: 'Highlight', icon: '✨' },
  { id: 'narrative', label: 'Narrative', icon: '💬' },
];
