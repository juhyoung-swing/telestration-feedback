import type { FeatureId, RailTab } from '../../types';

export type FeatureGroup = 'Tactic' | 'Action';

export type FeatureDef = {
  id: FeatureId;
  label: string;
  group: FeatureGroup;
  icon: string;
  implemented: boolean; // all effects are wired
  hint: string;
};

// Tile features in the Effect tab. The paper's Player group (Circle/Spotlight/Connector) is
// handled by the Player section instead; the static court Circle lives under Tactic.
export const FEATURES: FeatureDef[] = [
  { id: 'circle', label: 'Circle', group: 'Tactic', icon: '◎', implemented: true, hint: '코트를 클릭해 바닥에 고정 헤일로(원)를 놓습니다. (선수를 따라가는 원은 위 Player 목록의 "원")' },
  { id: 'path', label: 'Path', group: 'Tactic', icon: '↝', implemented: true, hint: '코트를 여러 번 클릭해 화살표 경로를 그립니다.' },
  { id: 'zone', label: 'Zone', group: 'Tactic', icon: '▰', implemented: true, hint: '코트를 3점 이상 클릭해 커버리지 존을 그립니다.' },
  { id: 'marker', label: 'Marker', group: 'Tactic', icon: '📍', implemented: true, hint: '코트를 클릭해 지점 마커를 놓습니다.' },
  { id: 'connector', label: 'Connector', group: 'Tactic', icon: '🔗', implemented: true, hint: '두 지점을 클릭해 잇는 선을 그립니다.' },
  { id: 'text', label: 'Text', group: 'Action', icon: '🅣', implemented: true, hint: '코트를 클릭해 텍스트 라벨을 놓습니다.' },
  { id: 'zoom-in', label: 'Zoom In', group: 'Action', icon: '🔍', implemented: true, hint: '코트를 클릭한 지점을 중심으로 화면을 확대합니다 (재생 중 punch-in).' },
];

export const FEATURE_GROUPS: FeatureGroup[] = ['Tactic', 'Action'];

export const RAIL_TABS: { id: RailTab; label: string; icon: string }[] = [
  { id: 'media', label: 'Media', icon: '🎬' },
  { id: 'court', label: 'Court', icon: '🎾' },
  { id: 'effect', label: 'Effect', icon: '✨' },
  { id: 'narrative', label: 'Narrative', icon: '💬' },
];
