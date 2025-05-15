import { Logger } from '../../lib/utils/logger.js';
import { sendToBackground } from '../../lib/messaging/sender.js';
import { _, _Error } from '../../lib/utils/i18n.js';

const logger = new Logger('SettingsHandlers');

/**
 * 保存设置到后台
 * @param settings 要保存的设置
 * @returns 保存操作的Promise
 */
export function saveSettings(settings: any): Promise<any> {
  logger.log(_('settings_handlers_save_settings', '保存设置: {0}'), settings);
  return sendToBackground('saveSettings', { settings });
}

/**
 * 从后台获取设置
 * @returns 包含设置的Promise
 */
export function getSettings(): Promise<any> {
  return sendToBackground('getSettings', {})
    .then(response => response.settings || {});
}

// 不再注册消息处理程序