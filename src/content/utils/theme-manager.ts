import { getSettingsService } from '../../lib/settings/service.js';

/**
 * 主题类型
 */
export type Theme = 'light' | 'dark';

/**
 * 主题设置类型
 */
export type ThemeSetting = Theme | 'system';

/**
 * 主题管理器类
 * 负责管理和应用内容页面主题
 */
export class ThemeManager {
  private static instance: ThemeManager;
  private settingsService = getSettingsService();
  private themeStylesheet: HTMLStyleElement | null = null;
  private currentTheme: Theme = 'light';
  
  private constructor() {
    // 私有构造函数
  }
  
  /**
   * 获取单例实例
   */
  public static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }
  
  /**
   * 初始化主题管理器
   * 创建样式元素并应用初始主题
   */
  public async initialize(): Promise<void> {
    // 创建样式元素
    this.createThemeStylesheet();
    
    // 监听系统主题变化
    this.listenForSystemThemeChanges();
    
    // 应用初始主题
    try {
      // 尝试从设置服务获取主题
      const themeSetting = this.settingsService.getSetting('theme');
      this.applyThemeSetting(themeSetting);
      
      // 添加设置变更监听
      this.settingsService.addChangeListener(settings => {
        this.applyThemeSetting(settings.theme);
      });
    } catch (error) {
      console.warn('从设置服务获取主题失败，使用系统主题', error);
      this.applyThemeSetting('system');
    }
    
    console.log('主题管理器初始化完成，当前主题:', this.currentTheme);
  }
  
  /**
   * 创建主题样式表
   */
  private createThemeStylesheet(): void {
    // 检查是否已存在
    if (document.getElementById('navigraph-theme-stylesheet')) {
      this.themeStylesheet = document.getElementById('navigraph-theme-stylesheet') as HTMLStyleElement;
      return;
    }
    
    // 创建新的样式表
    this.themeStylesheet = document.createElement('style');
    this.themeStylesheet.id = 'navigraph-theme-stylesheet';
    document.head.appendChild(this.themeStylesheet);
    console.log('创建了主题样式表元素');
  }
  
  /**
   * 监听系统主题变化
   */
  private listenForSystemThemeChanges(): void {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const themeSetting = this.settingsService.getSetting('theme');
      if (themeSetting === 'system') {
        this.applyTheme(event.matches ? 'dark' : 'light');
      }
    };
    
    // 设置初始状态
    handleChange(darkModeMediaQuery);
    
    // 监听变化
    darkModeMediaQuery.addEventListener('change', handleChange);
  }
  
  /**
   * 应用主题设置
   * 解析主题设置并应用相应的主题
   */
  public applyThemeSetting(themeSetting: ThemeSetting): void {
    console.log('应用主题设置:', themeSetting);
    
    if (themeSetting === 'system') {
      // 使用系统主题
      const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.applyTheme(isDarkMode ? 'dark' : 'light');
    } else {
      this.applyTheme(themeSetting);
    }
  }
  
  /**
   * 应用指定主题
   */
  public applyTheme(theme: Theme): void {
    if (this.currentTheme === theme && this.themeStylesheet?.textContent) {
      console.log('主题已经是', theme, '，无需更改');
      return;
    }
    
    console.log('设置主题为:', theme);
    this.currentTheme = theme;
    
    // 在根元素上设置主题属性
    document.documentElement.setAttribute('data-theme', theme);
    
    // 更新样式
    this.updateThemeStyles(theme);
    
    // 保存到本地存储
    this.saveThemeToLocalStorage(theme);
  }
  
  /**
   * 更新主题样式
   */
  private updateThemeStyles(theme: Theme): void {
    if (!this.themeStylesheet) {
      console.error('主题样式表元素不存在，无法更新样式');
      return;
    }
    
    // 暗色主题样式
    const darkThemeCSS = `
      :root {
        --background-color: #1a1d21;
        --card-bg: #272b33;
        --text-color: #e0e0e0;
        --label-color: #a0a0a0;
        --border-color: #3a3f48;
        --node-bg: #333842;
        --node-hover: #3e4350;
        --node-selected: #4a6ee0;
        --link-color: rgba(255, 255, 255, 0.3);
        --status-bg: #1f232a;
        --popup-bg: #272b33;
        --popup-header: #1f232a;
        --toolbar-bg: #272b33;
        --btn-bg: #333842;
        --btn-text: #e0e0e0;
        --btn-hover: #3e4350;
        --btn-primary: #4a6ee0;
        --btn-primary-hover: #3a5ec0;
        --scrollbar-track: #1a1d21;
        --scrollbar-thumb: #3a3f48;
        --zoom-controls-bg: rgba(39, 43, 51, 0.8);
      }
      
      /* 视图容器 */
      .navigation-container {
        background-color: var(--background-color);
        color: var(--text-color);
      }
      
      /* 节点样式 */
      .node-card {
        background-color: var(--node-bg);
        color: var(--text-color);
        border-color: var(--border-color);
      }
      
      .node-card:hover {
        background-color: var(--node-hover);
      }
      
      .node-selected {
        background-color: var(--node-selected) !important;
        color: white;
      }
      
      /* 连接线 */
      .link {
        stroke: var(--link-color);
      }
      
      /* 工具栏 */
      .toolbar {
        background-color: var(--toolbar-bg);
        border-color: var(--border-color);
      }
      
      .toolbar .btn {
        background-color: var(--btn-bg);
        color: var(--btn-text);
      }
      
      .toolbar .btn:hover {
        background-color: var(--btn-hover);
      }
      
      .toolbar .btn-primary {
        background-color: var(--btn-primary);
      }
      
      .toolbar .btn-primary:hover {
        background-color: var(--btn-primary-hover);
      }
      
      /* 状态栏 */
      .status-bar {
        background-color: var(--status-bg);
        border-color: var(--border-color);
        color: var(--label-color);
      }
      
      /* 缩放控件 */
      .zoom-controls {
        background-color: var(--zoom-controls-bg);
      }
      
      /* 滚动条 */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      
      ::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
      }
      
      ::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 4px;
      }
      
      ::-webkit-scrollbar-thumb:hover {
        background: var(--border-color);
      }
    `;
    
    // 亮色主题样式
    const lightThemeCSS = `
      :root {
        --background-color: #f5f7fa;
        --card-bg: #ffffff;
        --text-color: #333333;
        --label-color: #555555;
        --border-color: #e0e0e0;
        --node-bg: #ffffff;
        --node-hover: #f5f5f5;
        --node-selected: #4a6ee0;
        --link-color: rgba(0, 0, 0, 0.2);
        --status-bg: #f8f9fa;
        --popup-bg: #ffffff;
        --popup-header: #f5f7fa;
        --toolbar-bg: #ffffff;
        --btn-bg: #f5f7fa;
        --btn-text: #333333;
        --btn-hover: #e9ecef;
        --btn-primary: #4a6ee0;
        --btn-primary-hover: #3a5ec0;
        --scrollbar-track: #f1f1f1;
        --scrollbar-thumb: #d1d1d1;
        --zoom-controls-bg: rgba(255, 255, 255, 0.8);
      }
      
      /* 视图容器 */
      .navigation-container {
        background-color: var(--background-color);
        color: var(--text-color);
      }
      
      /* 节点样式 */
      .node-card {
        background-color: var(--node-bg);
        color: var(--text-color);
        border-color: var(--border-color);
      }
      
      .node-card:hover {
        background-color: var(--node-hover);
      }
      
      .node-selected {
        background-color: var(--node-selected) !important;
        color: white;
      }
      
      /* 连接线 */
      .link {
        stroke: var(--link-color);
      }
      
      /* 工具栏 */
      .toolbar {
        background-color: var(--toolbar-bg);
        border-color: var(--border-color);
      }
      
      .toolbar .btn {
        background-color: var(--btn-bg);
        color: var (--btn-text);
      }
      
      .toolbar .btn:hover {
        background-color: var(--btn-hover);
      }
      
      .toolbar .btn-primary {
        background-color: var(--btn-primary);
      }
      
      .toolbar .btn-primary:hover {
        background-color: var(--btn-primary-hover);
      }
      
      /* 状态栏 */
      .status-bar {
        background-color: var(--status-bg);
        border-color: var(--border-color);
        color: var(--label-color);
      }
      
      /* 缩放控件 */
      .zoom-controls {
        background-color: var(--zoom-controls-bg);
      }
      
      /* 滚动条 */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      
      ::-webkit-scrollbar-track {
        background: var(--scrollbar-track);
      }
      
      ::-webkit-scrollbar-thumb {
        background: var(--scrollbar-thumb);
        border-radius: 4px;
      }
      
      ::-webkit-scrollbar-thumb:hover {
        background: #aaaaaa;
      }
    `;
    
    this.themeStylesheet.textContent = theme === 'dark' ? darkThemeCSS : lightThemeCSS;
    console.log('已更新主题样式为:', theme);
  }
  
  /**
   * 获取当前主题
   */
  public getCurrentTheme(): Theme {
    return this.currentTheme;
  }
  
  /**
   * 切换主题
   */
  public toggleTheme(): void {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(newTheme);
  }

  /**
   * 从本地存储获取保存的主题
   * 如果没有保存的主题或发生错误，返回null
   */
  public getThemeFromLocalStorage(): Theme | null {
    try {
      const theme = localStorage.getItem('navigraph_theme') as Theme;
      return theme || null;
    } catch (error) {
      console.warn('从本地存储获取主题失败:', error);
      return null;
    }
  }

  /**
   * 保存主题到本地存储
   */
  private saveThemeToLocalStorage(theme: Theme): void {
    try {
      localStorage.setItem('navigraph_theme', theme);
    } catch (error) {
      console.warn('保存主题到本地存储失败:', error);
    }
  }
}

// 导出获取实例的方法
export const getThemeManager = (): ThemeManager => ThemeManager.getInstance();