import { useEffect, useState } from 'react';

export function usePersistentState<T>(key: string, defaultValue: T) {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return defaultValue;
    }
    try {
      const stored = window.localStorage.getItem(key);
      if (!stored) {
        return defaultValue;
      }
      return JSON.parse(stored) as T;
    } catch (error) {
      console.warn('Failed to read persisted state', error);
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to persist state', error);
    }
  }, [key, state]);

  return [state, setState] as const;
}
