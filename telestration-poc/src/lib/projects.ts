import type { Pt } from '../geometry/homography';
import type { Clip } from './clips';
import type { Fragments, Overlay, PlayerAnchor, Players, PoseData } from '../types';

// A project is one self-contained work unit: a video + its court calibration + all effects.
// Metadata lives in localStorage; the (large) video blob lives in IndexedDB, keyed by videoKey.
export type Project = {
  id: string;
  name: string;
  updatedAt: number;
  videoName: string;
  videoKey: string | null;            // IndexedDB key for an uploaded video; null = bundled /court.mp4
  corners: Pt[] | null;               // 4 calibration image points (video px); null = not calibrated
  calibMethod: 'corner' | 'line' | null;
  overlays: Overlay[];
  clips?: Clip[];                     // base-video EDL; absent/empty = identity (whole video, one clip)
  playerAnchors: PlayerAnchor[];
  thumbnail?: string;                 // small JPEG data URL captured from a video frame
  analyzed?: boolean;                 // 선수 위치 분석 has been run (data in IndexedDB 'analysis')
  poseAnalyzed?: boolean;             // 자세(폼) 분석 has been run (pose in IndexedDB 'analysis')
  trackFps?: number;                  // fps the tracking data was sampled at
};

// Analysis output for one project (produced in-app by the Electron ML pipeline).
// Position (fragments/players) and pose are independent — either may be absent.
export type AnalysisData = { fps: number; fragments?: Fragments; players?: Players; pose?: PoseData };

const KEY = 'tele.projects.v1';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.floor(performance.now())}`);

export function listProjects(): Project[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]') as Project[];
    return Array.isArray(arr) ? arr.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function saveProject(p: Project): void {
  const all = listProjects().filter((x) => x.id !== p.id);
  all.push(p);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota — ignore for POC */ }
}

export function deleteProject(id: string): void {
  const p = listProjects().find((x) => x.id === id);
  localStorage.setItem(KEY, JSON.stringify(listProjects().filter((x) => x.id !== id)));
  if (p?.videoKey) void deleteVideoBlob(p.videoKey);
  void deleteAnalysis(id);
}

export function newProject(name: string): Project {
  return { id: uid(), name: name.trim() || '제목 없음', updatedAt: Date.now(), videoName: 'court.mp4', videoKey: null, corners: null, calibMethod: null, overlays: [], playerAnchors: [] };
}

// ── IndexedDB: large per-project blobs (video) + analysis JSON ───────────────
const DB = 'tele', VIDEOS = 'videos', ANALYSIS = 'analysis';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(VIDEOS)) db.createObjectStore(VIDEOS);
      if (!db.objectStoreNames.contains(ANALYSIS)) db.createObjectStore(ANALYSIS);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(store: string, key: string, val: unknown): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).get(key);
    rq.onsuccess = () => res((rq.result as T) ?? null);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(store: string, key: string): Promise<void> {
  const db = await idb();
  return new Promise((res) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

export function newVideoKey(): string { return `v-${uid()}`; }
export const saveVideoBlob = (key: string, blob: Blob) => idbPut(VIDEOS, key, blob);
export const loadVideoBlob = (key: string) => idbGet<Blob>(VIDEOS, key);
export const deleteVideoBlob = (key: string) => idbDel(VIDEOS, key);

// analysis keyed by project id (survives video re-uploads within a project)
export const saveAnalysis = (id: string, data: AnalysisData) => idbPut(ANALYSIS, id, data);
export const loadAnalysis = (id: string) => idbGet<AnalysisData>(ANALYSIS, id);
export const deleteAnalysis = (id: string) => idbDel(ANALYSIS, id);
