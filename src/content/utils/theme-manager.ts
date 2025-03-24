import { Theme } from '../../lib/settings/types.js';
import { getSettingsService } from '../../lib/settings/service.js';

/**
 * 主题管理器类
 * 负责管理和应用内容页面主题
 */
export class ThemeManager {
  private static instance: ThemeManager;
  private settingsService = getSettingsService();
  private themeStylesheet: HTMLStyleElement | null = null;
  private currentTheme: Theme = "light";

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
    // 监听系统主题变化
    this.listenForSystemThemeChanges();

    // 确保主题样式表已加载
    this.ensureStylesheetLoaded();

    // 应用初始主题
    try {
      // 从全局配置获取主题，如果存在
      let theme: Theme = 'system';
      
      if (window.navigraphSettings && window.navigraphSettings.theme) {
        theme = window.navigraphSettings.theme;
        console.log('从全局配置读取主题设置:', theme);
      }
      
      this.applyTheme(theme);
    } catch (error) {
      console.warn("获取主题设置失败，使用系统主题", error);
      this.applyTheme("system");
    }

    console.log("主题管理器初始化完成，当前主题:", this.currentTheme);
  }

  /**
   * 创建主题样式表
   */
  private createThemeStylesheet(): void {
    // 检查是否已存在
    if (document.getElementById("navigraph-theme-stylesheet")) {
      this.themeStylesheet = document.getElementById(
        "navigraph-theme-stylesheet"
      ) as HTMLStyleElement;
      return;
    }

    // 创建新的样式表
    this.themeStylesheet = document.createElement("style");
    this.themeStylesheet.id = "navigraph-theme-stylesheet";
    document.head.appendChild(this.themeStylesheet);
    console.log("创建了主题样式表元素");
  }

  /**
   * 监听系统主题变化
   */
  private listenForSystemThemeChanges(): void {
    const darkModeMediaQuery = window.matchMedia(
      "(prefers-color-scheme: dark)"
    );

    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const theme = this.settingsService.getSetting("theme");
      if (theme === "system") {
        this.applyTheme(event.matches ? "dark" : "light");
      }
    };

    // 设置初始状态
    handleChange(darkModeMediaQuery);

    // 监听变化
    darkModeMediaQuery.addEventListener("change", handleChange);
  }

  /**
   * 应用主题设置
   * 解析主题设置并应用相应的主题
   */
  public applyTheme(theme: Theme): void {
    console.log("应用主题设置:", theme);

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
    if (this.currentTheme === theme && this.themeStylesheet?.textContent) {
      console.log("主题已经是", theme, "，无需更改");
      return;
    }

    console.log("设置主题为:", theme);
    this.currentTheme = theme;

    // 在根元素上设置主题属性
    document.documentElement.setAttribute("data-theme", theme);

    // 更新样式
    this.updateThemeStyles(theme);

    // 更新SVG元素
    this.updateSvgElementsForTheme(theme);

    // 保存到本地存储
    this.saveThemeToLocalStorage(theme);
  }

  /**
   * 更新主题样式
   */
  private updateThemeStyles(theme: Theme): void {
    // 不再需要创建内联样式表
    // 只需要设置根元素的 data-theme 属性
    document.documentElement.setAttribute("data-theme", theme);

    console.log("已更新主题为:", theme);
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
      console.warn("从本地存储获取主题失败:", error);
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
      console.warn("保存主题到本地存储失败:", error);
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
      link.href = chrome.runtime.getURL("dist/content/styles/themes.css");
      document.head.appendChild(link);
      console.log("已添加主题样式表");
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