import { Logger } from '../../lib/utils/logger.js';
import { Theme } from '../../lib/settings/types.js';
import { getSettingsService } from '../../lib/settings/service.js';
import { i18n, I18nError } from '../../lib/utils/i18n-utils.js';

const logger = new Logger('ThemeManager');

/**
 * 主题管理器类
 * 负责管理和应用内容页面主题
 */
export class ThemeManager {
  private static instance: ThemeManager;
  private settingsService = getSettingsService();
  private themeStylesheet: HTMLStyleElement | null = null;
  private currentTheme: Theme = "light";
  private initialized: boolean = false; // 添加初始化标志

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
    // 防止重复初始化
    if (this.initialized) {
      logger.log(i18n('theme_manager_already_initialized', '主题管理器已初始化，跳过'));
      return;
    }
    
    this.initialized = true; // 设置初始化标志
    
    // 确保主题样式表已加载
    this.ensureStylesheetLoaded();
    
    // 初始化系统主题监听
    this.initializeSystemThemeListener();
    
    try {
      // 从全局配置或设置服务获取主题
      let theme: Theme = 'system';
      
      if (window.navigraphSettings && window.navigraphSettings.theme) {
        theme = window.navigraphSettings.theme;
        logger.log(i18n('theme_manager_read_global_config', '从全局配置读取主题设置: {0}'), theme);
      } else {
        // 尝试从设置服务获取
        theme = this.settingsService.getSetting("theme") || 'system';
        logger.log(i18n('theme_manager_read_settings_service', '从设置服务读取主题设置: {0}'), theme);
      }
      
      // 在初始化时应用主题
      this.applyTheme(theme);
    } catch (error) {
      logger.warn(i18n('theme_manager_settings_failed', '获取主题设置失败，使用系统主题: {0}'), error instanceof Error ? error.message : String(error));
      this.applyTheme("system");
    }
  
    logger.log(i18n('theme_manager_init_complete', '主题管理器初始化完成，当前主题: {0}'), this.currentTheme);
  }

  /**
   * 检查主题管理器是否已初始化
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 初始化系统主题监听器，但不立即触发
   */
  private initializeSystemThemeListener(): void {
    const darkModeMediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

    const handleChange = (event: MediaQueryListEvent) => {
      const theme = this.settingsService.getSetting("theme");
      if (theme === "system") {
        this.applySpecificTheme(event.matches ? "dark" : "light");
      }
    };

    // 只监听变化，不立即触发
    darkModeMediaQuery.addEventListener("change", handleChange);
  }

  /**
   * 应用主题设置
   * 解析主题设置并应用相应的主题
   */
  public applyTheme(theme: Theme): void {
    logger.log(i18n('theme_manager_applying_theme', '应用主题设置: {0}'), theme);
    
    if (theme === "system") {
      // 使用系统主题
      const isDarkMode = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      this.applySpecificTheme(isDarkMode ? "dark" : "light");
    } else {
      this.applySpecificTheme(theme);
    }
  }

  /**
   * 应用指定主题
   */
  private applySpecificTheme(theme: Theme): void {
    // 在根元素上设置主题属性
    document.documentElement.setAttribute("data-theme", theme);
    // 如果主题已经应用，避免重复工作
    if (this.currentTheme === theme) {
      logger.log(i18n('theme_manager_no_change_needed', '主题已经是 {0}，无需更改'), theme);
      return;
    }

    logger.log(i18n('theme_manager_setting_theme', '设置主题为: {0}'), theme);
    this.currentTheme = theme;

    // 更新SVG元素
    this.updateSvgElementsForTheme(theme);

    // 保存到本地存储（除非是通过系统主题而应用的）
    if (this.settingsService.getSetting("theme") !== "system") {
      this.saveThemeToLocalStorage(theme);
    }

    logger.log(i18n('theme_manager_theme_updated', '已更新主题为: {0}'), theme);
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
    const newTheme = this.currentTheme === "light" ? "dark" : "light";
    this.applyTheme(newTheme);
  }

  /**
   * 从本地存储获取保存的主题
   * 如果没有保存的主题或发生错误，返回null
   */
  public getThemeFromLocalStorage(): Theme | null {
    try {
      const theme = localStorage.getItem("navigraph_theme") as Theme;
      return theme || null;
    } catch (error) {
      logger.warn(i18n('theme_manager_localstorage_get_failed', '从本地存储获取主题失败: {0}'), error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * 保存主题到本地存储
   */
  private saveThemeToLocalStorage(theme: Theme): void {
    try {
      localStorage.setItem("navigraph_theme", theme);
    } catch (error) {
      logger.warn(i18n('theme_manager_localstorage_save_failed', '保存主题到本地存储失败: {0}'), error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 确保主题样式表已加载
   */
  private ensureStylesheetLoaded(): void {
    // 检查是否已存在主题样式表
    if (!document.querySelector('link[href*="themes.css"]')) {
      // 创建链接元素
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("content/styles/themes.css");
      document.head.appendChild(link);
      logger.log(i18n('theme_manager_stylesheet_added', '已添加主题样式表'));
    }
  }

  /**
   * 根据当前主题更新SVG元素的样式
   */
  private updateSvgElementsForTheme(theme: Theme): void {
    // 获取所有SVG元素
    const svgElements = document.querySelectorAll("svg");

    svgElements.forEach((svg) => {
      // 更新节点颜色
      const nodes = svg.querySelectorAll(".node");
      nodes.forEach((node) => {
        if (theme === "dark") {
          (node as SVGElement).style.fill = "var(--svg-node-fill)";
          (node as SVGElement).style.stroke = "var(--svg-node-stroke)";
        } else {
          (node as SVGElement).style.fill = "var(--svg-node-fill)";
          (node as SVGElement).style.stroke = "var(--svg-node-stroke)";
        }
      });

      // 更新连接线颜色
      const links = svg.querySelectorAll(".link");
      links.forEach((link) => {
        (link as SVGElement).style.stroke =
          theme === "dark" ? "var(--svg-link)" : "var(--svg-link)";
      });

      // 更新文本颜色
      const texts = svg.querySelectorAll("text");
      texts.forEach((text) => {
        (text as SVGElement).style.fill =
          theme === "dark" ? "var(--svg-text)" : "var(--svg-text)";
      });
    });
  }
}

// 导出获取实例的方法
export const getThemeManager = (): ThemeManager => ThemeManager.getInstance();