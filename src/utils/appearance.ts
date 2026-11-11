import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

export type AppearanceChoice = 'system' | 'light' | 'dark';

const KEY = 'foldspace.appearance';
const listeners = new Set<() => void>();
let choice: AppearanceChoice = 'system';

function apply(next: AppearanceChoice) {
  choice = next;
  // 'unspecified' hands the decision back to the system setting.
  Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  listeners.forEach(listener => listener());
}

/** Restores the saved choice. Call once when the app starts. */
export async function loadAppearance() {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') apply(saved);
  } catch {
    // Nothing saved, or storage is unavailable: follow the system.
  }
}

export function setAppearance(next: AppearanceChoice) {
  apply(next);
  void AsyncStorage.setItem(KEY, next).catch(() => {});
}

export function useAppearance() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => choice,
    () => choice,
  );
}
