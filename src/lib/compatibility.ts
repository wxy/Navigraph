import browser from 'webextension-polyfill';

// 统一API调用
export const getActiveTab = async () => {
  if (typeof browser === 'undefined') {
    return new Promise<chrome.tabs.Tab>(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0]);
      });
    });
  }
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
};

// Firefox特殊处理
export const handleFirefox = (callback: () => void) => {
  if (navigator.userAgent.includes('Firefox')) {
    callback();
  }
};