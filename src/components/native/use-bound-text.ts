import { useNativeState } from '@expo/ui';
import { useCallback, useEffect, useRef } from 'react';

/** Keep native editing local; only write when a parent supplies a different value. */
export function useBoundText(value: string, onChange: (value: string) => void) {
  const state = useNativeState(value);
  const lastNativeValue = useRef(value);
  const lastPropValue = useRef(value);

  useEffect(() => {
    if (value === lastPropValue.current) return;
    lastPropValue.current = value;
    if (value !== lastNativeValue.current) {
      lastNativeValue.current = value;
      state.set(value);
    }
  }, [state, value]);

  const onChangeText = useCallback((nextValue: string) => {
    lastNativeValue.current = nextValue;
    onChange(nextValue);
  }, [onChange]);

  return { state, onChangeText };
}
