import type { Pt } from '../geometry/homography';
import type { Overlay, PlayerAnchor } from '../types';

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
  playerAnchors: PlayerAnchor[];
  thumbnail?: string;                 // small JPEG data URL captured from a video frame
};

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
}

export function newProject(name: string): Project {
  return { id: uid(), name: name.trim() || '제목 없음', updatedAt: Date.now(), videoName: 'court.mp4', videoKey: null, corners: null, calibMethod: null, overlays: [], playerAnchors: [] };
}

// ── video blobs in IndexedDB ────────────────────────────────────────────────
const DB = 'tele', STORE = 'videos';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export function newVideoKey(): string { return `v-${uid()}`; }
export async function saveVideoBlob(key: string, blob: Blob): Promise<void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function loadVideoBlob(key: string): Promise<Blob | null> {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(key);
    rq.onsuccess = () => res((rq.result as Blob) ?? null);
    rq.onerror = () => rej(rq.error);
  });
}
export async function deleteVideoBlob(key: string): Promise<void> {
  const db = await idb();
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
