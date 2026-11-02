/** Small helpers shared by the SQLite repositories. */
export function first<T extends Record<string, SqlStorageValue>>(cursor: SqlStorageCursor<T>): T | null {
  return cursor.toArray()[0] ?? null;
}

export function bool(value: SqlStorageValue): boolean {
  return value === 1;
}

export function json<T>(value: SqlStorageValue): T {
  return JSON.parse(String(value)) as T;
}
