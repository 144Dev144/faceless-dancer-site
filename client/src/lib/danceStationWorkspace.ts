const DB_NAME = "dance-station-workspace";
const DB_VERSION = 1;
const ITEM_STORE = "items";
const SETTINGS_STORE = "settings";

export interface BrowserWorkspaceItem {
  id: string;
  title: string;
  kind: string;
  source: "private" | "browser" | "public-library" | "account-sync";
  creatorName?: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface BrowserWorkspaceStatus {
  indexedDb: boolean;
  opfs: boolean;
  persisted: boolean;
  estimate: {
    usage: number;
    quota: number;
  } | null;
}

function openWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEM_STORE)) {
        const store = db.createObjectStore(ITEM_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open browser workspace"));
    request.onsuccess = () => resolve(request.result);
  });
}

function storeRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("Browser workspace request failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Browser workspace transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("Browser workspace transaction failed"));
  });
}

export async function listWorkspaceItems(): Promise<BrowserWorkspaceItem[]> {
  const db = await openWorkspaceDb();
  try {
    const tx = db.transaction(ITEM_STORE, "readonly");
    const items = await storeRequest(tx.objectStore(ITEM_STORE).getAll());
    return (items as BrowserWorkspaceItem[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    db.close();
  }
}

export async function saveWorkspaceItem(item: BrowserWorkspaceItem): Promise<BrowserWorkspaceItem> {
  const db = await openWorkspaceDb();
  try {
    const tx = db.transaction(ITEM_STORE, "readwrite");
    await storeRequest(tx.objectStore(ITEM_STORE).put(item));
    await transactionComplete(tx);
    return item;
  } finally {
    db.close();
  }
}

export async function getWorkspaceSetting<T>(key: string): Promise<T | null> {
  const db = await openWorkspaceDb();
  try {
    const tx = db.transaction(SETTINGS_STORE, "readonly");
    const row = await storeRequest(tx.objectStore(SETTINGS_STORE).get(key));
    return row ? (row.value as T) : null;
  } finally {
    db.close();
  }
}

export async function setWorkspaceSetting<T>(key: string, value: T): Promise<void> {
  const db = await openWorkspaceDb();
  try {
    const tx = db.transaction(SETTINGS_STORE, "readwrite");
    await storeRequest(tx.objectStore(SETTINGS_STORE).put({ key, value }));
    await transactionComplete(tx);
  } finally {
    db.close();
  }
}

export async function getBrowserWorkspaceStatus(): Promise<BrowserWorkspaceStatus> {
  const storageManager = navigator.storage;
  const estimate = storageManager?.estimate ? await storageManager.estimate() : null;
  const persisted = storageManager?.persisted ? await storageManager.persisted() : false;
  return {
    indexedDb: "indexedDB" in window,
    opfs: Boolean(navigator.storage && "getDirectory" in navigator.storage),
    persisted,
    estimate: estimate
      ? {
          usage: estimate.usage ?? 0,
          quota: estimate.quota ?? 0,
        }
      : null,
  };
}

export async function requestPersistentWorkspaceStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) {
    return false;
  }
  return navigator.storage.persist();
}

export function createPrivateAssetWorkspaceItem(file: File, title?: string, kindOverride?: string): BrowserWorkspaceItem {
  const now = new Date().toISOString();
  const id = `private-${crypto.randomUUID()}`;
  const kind = kindOverride || (file.type.startsWith("audio/")
    ? "audio"
    : file.type.startsWith("image/")
      ? "image"
      : "file");
  return {
    id,
    title: title?.trim() || file.name,
    kind,
    source: "private",
    createdAt: now,
    updatedAt: now,
    metadata: {
      storage: "browser",
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      blob: file,
    },
  };
}
