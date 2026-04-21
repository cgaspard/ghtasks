import { writable, type Writable } from "svelte/store";

/**
 * A writable Svelte store backed by localStorage. Falls back to in-memory
 * behavior if localStorage is unavailable or serialization fails.
 *
 * `serialize`/`deserialize` let us handle non-JSON-native types (Set, Map)
 * without forcing every caller to juggle conversion at read/write time.
 */
export function persistent<T>(
  key: string,
  initial: T,
  opts: {
    serialize?: (value: T) => string;
    deserialize?: (raw: string) => T;
  } = {},
): Writable<T> {
  const storageKey = `ghtasks.${key}`;
  const serialize = opts.serialize ?? ((v) => JSON.stringify(v));
  const deserialize = opts.deserialize ?? ((raw) => JSON.parse(raw) as T);

  const loaded = (() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return initial;
      return deserialize(raw);
    } catch {
      return initial;
    }
  })();

  const store = writable<T>(loaded);
  store.subscribe((v) => {
    try {
      localStorage.setItem(storageKey, serialize(v));
    } catch {
      // localStorage full / disabled — ignore, keep running in-memory.
    }
  });
  return store;
}

/** Convenience helpers for Set<string> since JSON doesn't support Set. */
export const stringSetCodec = {
  serialize: (v: Set<string>) => JSON.stringify([...v]),
  deserialize: (raw: string): Set<string> => {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch {
      return new Set();
    }
  },
};

/** Set that may contain null (used for status filter where null = "No Status"). */
export const nullableStringSetCodec = {
  serialize: (v: Set<string | null>) => JSON.stringify([...v]),
  deserialize: (raw: string): Set<string | null> => {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch {
      return new Set();
    }
  },
};
