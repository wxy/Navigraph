import { NavigationRecord } from '../types/webext';

/**
 * 类型安全地从storage获取历史记录
 */
export function getHistory(): Promise<NavigationRecord[]> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('history', (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve((result.history as NavigationRecord[]) || []);
      }
    });
  });
}

/**
 * 类型安全地保存历史记录
 */
export function saveHistory(records: NavigationRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ history: records }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}