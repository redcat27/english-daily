// 播报语速：用户可调，记忆在本地。
// 用外部 store + useSyncExternalStore，避免在 effect 里 setState。
"use client";

import { useSyncExternalStore } from "react";

const KEY = "english_speed";
export const MIN_SPEED = 0.6;
export const MAX_SPEED = 1.4;

let current = 0.85;
let defaultSpeed = 0.85;
let loaded = false;
const listeners = new Set<() => void>();

function readStored(): number {
  if (typeof window === "undefined") return current;
  if (!loaded) {
    loaded = true;
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved >= MIN_SPEED && saved <= MAX_SPEED) current = saved;
    } catch {
      /* 忽略本地存储异常 */
    }
  }
  return current;
}

export function getSpeed(): number {
  return readStored();
}

/** 服务端默认值（用户没手动调过时生效） */
export function initSpeed(value: number) {
  defaultSpeed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, value || 1));
  if (!loaded) {
    current = defaultSpeed;
    loaded = true;
  }
}

export function setSpeed(value: number) {
  const next = Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number(value) || 1));
  current = next;
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    /* 忽略本地存储异常 */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpeed(): number {
  return useSyncExternalStore(
    subscribe,
    () => readStored(),
    () => defaultSpeed
  );
}

export function useDefaultSpeed(): number {
  return defaultSpeed;
}

