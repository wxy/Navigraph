import { saveSettings, getSettings } from './messaging/settings-handlers.js';

// 初始化选项页
async function initOptionsPage() {
  try {
    // 加载设置
    const settings = await getSettings();
    
    // 更新UI
    //updateSettingsUI(settings);
    
    // 设置表单提交处理
    document.querySelector('#settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // 收集表单数据
      const formData = new FormData(e.target as HTMLFormElement);
      const newSettings = {
        // 转换表单数据为设置对象
      };
      
      try {
        await saveSettings(newSettings);
        showNotification('保存成功', '设置已保存');
      } catch (error: any) {
        showNotification('保存失败', error.message, 'error');
      }
    });
    
  } catch (error) {
    console.error('初始化选项页失败:', error);
  }
}

// 显示通知
function showNotification(title: string, message: string, type: 'success' | 'error' = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}
