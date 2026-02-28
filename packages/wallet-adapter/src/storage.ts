import type { AdapterStorage } from "./types.js";

const isStorageAvailable = () => {
  return typeof window !== "undefined" && window.localStorage != null;
};

export const createDefaultStorage = (): AdapterStorage => {
  if (!isStorageAvailable()) {
    const mem = new Map<string, string>();
    return {
      get: (key: string) => mem.get(key) ?? null,
      set: (key: string, value: string) => {
        mem.set(key, value);
      },
      remove: (key: string) => {
        mem.delete(key);
      },
    };
  }

  return {
    get: (key: string) => window.localStorage.getItem(key),
    set: (key: string, value: string) => window.localStorage.setItem(key, value),
    remove: (key: string) => window.localStorage.removeItem(key),
  };
};

export const readJson = async <T>(storage: AdapterStorage, key: string, fallback: T): Promise<T> => {
  try {
    const raw = await storage.get(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJson = async <T>(storage: AdapterStorage, key: string, value: T): Promise<void> => {
  await storage.set(key, JSON.stringify(value));
};
