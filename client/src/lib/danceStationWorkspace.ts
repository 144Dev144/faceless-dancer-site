const DB_NAME = "dance-station-workspace";
const DB_VERSION = 1;
const ITEM_STORE = "items";
const SETTINGS_STORE = "settings";

let workspaceDbPromise: Promise<IDBDatabase> | undefined;

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
  if (workspaceDbPromise) return workspaceDbPromise;

  workspaceDbPromise = new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      workspaceDbPromise = undefined;
      reject(error);
    };
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
    request.onblocked = () => fail(new Error("Browser workspace is waiting for another tab to release its database connection"));
    request.onerror = () => fail(request.error ?? new Error("Could not open browser workspace"));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        workspaceDbPromise = undefined;
      };
      db.onclose = () => {
        workspaceDbPromise = undefined;
      };
      resolve(db);
    };
  });
  return workspaceDbPromise;
}

function workspaceError(operation: string, error: unknown): Error {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (name === "QuotaExceededError" || /quota|storage is full/i.test(detail)) {
    return new Error(`Could not ${operation}: browser storage is full. Clear browser workspace space and try again.`);
  }
  if (name === "AbortError" || name === "TransactionInactiveError" || name === "InvalidStateError" || /transaction.*abort|request was aborted|transaction is inactive|database connection is closed/i.test(detail)) {
    return new Error(`Could not ${operation}: browser storage was interrupted. Refresh Private Assets and try again.`);
  }
  return new Error(`Could not ${operation}. Please try again.`);
}

function isRetryableWorkspaceError(error: unknown): boolean {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return name === "AbortError"
    || name === "TransactionInactiveError"
    || name === "InvalidStateError"
    || /transaction.*abort|request was aborted|transaction is inactive|browser storage was interrupted|database connection is closed/i.test(detail);
}

function runWorkspaceTransactionAttempt<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: string,
  action: (store: IDBObjectStore, setResult: (value: T) => void, setRequestError: (error: unknown) => void) => void,
): Promise<T> {
  return openWorkspaceDb().then((db) => new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    let requestError: unknown;
    let settled = false;
    const tx = db.transaction(storeName, mode);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    tx.oncomplete = () => finish(() => {
      if (result === undefined) {
        reject(workspaceError(operation, new Error("The transaction completed without a result")));
      } else {
        resolve(result);
      }
    });
    tx.onerror = () => {
      requestError = requestError || tx.error;
    };
    tx.onabort = () => finish(() => reject(workspaceError(operation, requestError || tx.error || new Error("The browser transaction was aborted"))));

    try {
      action(tx.objectStore(storeName), (value) => {
        result = value;
      }, (error) => {
        requestError = error;
      });
    } catch (error) {
      requestError = error;
      try {
        tx.abort();
      } catch {
        finish(() => reject(workspaceError(operation, error)));
      }
    }
  })).catch((error) => {
    throw workspaceError(operation, error);
  });
}

function runWorkspaceTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: string,
  action: (store: IDBObjectStore, setResult: (value: T) => void, setRequestError: (error: unknown) => void) => void,
): Promise<T> {
  return runWorkspaceTransactionAttempt(storeName, mode, operation, action).catch((error) => {
    if (!isRetryableWorkspaceError(error)) throw error;
    return new Promise<T>((resolve, reject) => {
      window.setTimeout(() => {
        runWorkspaceTransactionAttempt(storeName, mode, operation, action).then(resolve, reject);
      }, 0);
    });
  });
}

export async function listWorkspaceItems(): Promise<BrowserWorkspaceItem[]> {
  return runWorkspaceTransaction<BrowserWorkspaceItem[]>(ITEM_STORE, "readonly", "load Private Assets", (store, setResult, setRequestError) => {
    const request = store.getAll();
    request.onerror = () => setRequestError(request.error);
    request.onsuccess = () => {
      const items = request.result as BrowserWorkspaceItem[];
      setResult(items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    };
  });
}

let workspaceWriteQueue = Promise.resolve();

function queueWorkspaceWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = workspaceWriteQueue.then(operation, operation);
  workspaceWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function saveWorkspaceItem(item: BrowserWorkspaceItem): Promise<BrowserWorkspaceItem> {
  return queueWorkspaceWrite(() => runWorkspaceTransaction<BrowserWorkspaceItem>(ITEM_STORE, "readwrite", "save Private Asset", (store, setResult, setRequestError) => {
    const request = store.put(item);
    request.onerror = () => setRequestError(request.error);
    request.onsuccess = () => setResult(item);
  }));
}

export async function getWorkspaceSetting<T>(key: string): Promise<T | null> {
  return runWorkspaceTransaction<T | null>(SETTINGS_STORE, "readonly", "load browser workspace settings", (store, setResult, setRequestError) => {
    const request = store.get(key);
    request.onerror = () => setRequestError(request.error);
    request.onsuccess = () => {
      const row = request.result as { value?: T } | undefined;
      setResult(row ? row.value ?? null : null);
    };
  });
}

export async function setWorkspaceSetting<T>(key: string, value: T): Promise<void> {
  await queueWorkspaceWrite(() => runWorkspaceTransaction<boolean>(SETTINGS_STORE, "readwrite", "save browser workspace settings", (store, setResult, setRequestError) => {
    const request = store.put({ key, value });
    request.onerror = () => setRequestError(request.error);
    request.onsuccess = () => setResult(true);
  }));
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

export function createRemoteAudioWorkspaceItem(input: {
  jobId: string;
  title: string;
  publicUrl: string;
  objectPath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
}): BrowserWorkspaceItem {
  return {
    id: `remote-generation-${input.jobId}`,
    title: input.title,
    kind: "audio",
    source: "private",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    metadata: {
      storage: "remote-cdn",
      sourceTool: "remote-generation",
      remoteJobId: input.jobId,
      publicUrl: input.publicUrl,
      objectPath: input.objectPath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
    },
  };
}
