const fs = require("fs-extra");
const path = require("path");
const glob = require("glob");

class I18nPlugin {
  constructor(options = {}) {
    // 默认选项
    this.options = {
      // 源代码目录
      srcDir: "./",
      // 输出目录
      outputDir: "dist/_locales",
      // 临时目录
      tempOutputDir: "_locales",
      // 默认语言
      defaultLang: options.defaultLang || "en",
      // i18n文件匹配模式
      pattern: "**/*.i18n.json",
      ...options,
    };

    // 从 manifest.json 读取默认语言
    if (!options.defaultLang) {
      try {
        const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
        if (manifest.default_locale) {
          this.options.defaultLang = manifest.default_locale;
        }
      } catch (error) {
        console.log("未能从 manifest.json 读取默认语言，使用 en");
      }
    }

    // 初始化冷却时间和上次运行时间戳
    this.cooldownPeriod = 1000; // 1秒冷却时间
    this.lastRunTimestamp = 0;

    // 添加写入文件跟踪
    this.recentlyWrittenFiles = new Map(); // 文件路径 -> 写入时间戳
    this.fileTrackingTimeout = 3000; // 3秒内认为是插件写入的文件

    // 添加首次运行标记
    this.isFirstWatchRun = true;
  }

  // 跟踪文件写入
  trackFileWrite(filePath) {
    this.recentlyWrittenFiles.set(filePath, Date.now());
  }

  // 检查文件是否是由插件刚刚写入的
  isRecentlyWrittenByPlugin(filePath) {
    const writeTime = this.recentlyWrittenFiles.get(filePath);
    if (!writeTime) return false;

    const now = Date.now();
    if (now - writeTime > this.fileTrackingTimeout) {
      // 超过超时时间，从跟踪列表中移除
      this.recentlyWrittenFiles.delete(filePath);
      return false;
    }

    return true;
  }

  // 添加辅助方法到类级别
  extractSourceFiles(description) {
    const matches = description?.match(/@([^\s]+)/g) || [];
    return matches.map((m) => m.substring(1));
  }

  cleanDescription(description) {
    // 移除所有 @文件路径 信息
    return description?.replace(/@[^\s]+/g, "").trim() || "";
  }

  apply(compiler) {
    // 在编译开始前处理本地化文件
    compiler.hooks.beforeRun.tapAsync("I18nPlugin", (compilation, callback) => {
      console.log("\n开始处理本地化文件...");
      this.processI18nFiles();
      callback();
    });

    // 添加定期扫描，检查文件数量变化
    let knownI18nFileCount = 0;

    // 在监视模式下更智能地判断是否需要处理
    compiler.hooks.watchRun.tapAsync("I18nPlugin", (compilation, callback) => {
      // 首次运行时强制处理
      if (this.isFirstWatchRun) {
        console.log("\n首次监视模式启动，处理本地化文件...");
        this.isFirstWatchRun = false;
        this.processI18nFiles();

        // 记录初始文件数
        const i18nFiles = glob.sync(
          path.join(this.options.srcDir, this.options.pattern)
        );
        knownI18nFileCount = i18nFiles.length;

        callback();
        return;
      }

      // 检查文件数量是否变化
      const i18nFiles = glob.sync(
        path.join(this.options.srcDir, this.options.pattern)
      );
      if (i18nFiles.length !== knownI18nFileCount) {
        console.log(
          `\n检测到i18n文件数量变化 (${knownI18nFileCount} -> ${i18nFiles.length})，处理本地化文件...`
        );
        knownI18nFileCount = i18nFiles.length;
        this.processI18nFiles();
        callback();
        return;
      }

      // 清理超时的文件记录
      const now = Date.now();
      for (const [file, time] of this.recentlyWrittenFiles.entries()) {
        if (now - time > this.fileTrackingTimeout) {
          this.recentlyWrittenFiles.delete(file);
        }
      }

      // 获取发生变化的文件
      const changedFiles = compilation.modifiedFiles || new Set();
      let shouldProcess = false;
      let isTranslationChanged = false;

      // 分析变化的文件
      changedFiles.forEach((file) => {
        // 如果是插件自己写入的文件，忽略
        if (this.isRecentlyWrittenByPlugin(file)) {
          return;
        }

        // 处理源文件变化
        if (file.endsWith(".i18n.json")) {
          shouldProcess = true;
        }
        // 处理翻译文件变化
        else if (
          file.includes("_locales/") &&
          file.endsWith("/messages.json") &&
          !file.includes(`_locales/${this.options.defaultLang}/`)
        ) {
          shouldProcess = true;
          isTranslationChanged = true;
        }
      });

      // 如果没有相关文件变化，直接跳过处理
      if (!shouldProcess) {
        callback();
        return;
      }

      if (isTranslationChanged) {
        console.log("\n检测到翻译文件变化，重新处理本地化...");
      } else {
        console.log("\n检测到源文件变化，处理本地化文件...");
      }

      this.processI18nFiles();
      callback();
    });
  }

  processI18nFiles() {
    const defaultLang = this.options.defaultLang;
    const srcDir = this.options.srcDir;
    const tempOutputDir = this.options.tempOutputDir;

    // 1. 收集所有 i18n.json 文件
    const i18nFiles = glob.sync(path.join(srcDir, this.options.pattern));
    console.log(`发现 ${i18nFiles.length} 个本地化源文件`);

    // 2. 合并所有文件创建默认语言文件
    const defaultMessages = {};
    const conflictStats = {}; // 跟踪冲突的消息ID

    i18nFiles.forEach((file) => {
      try {
        const relativePath = path.relative(srcDir, file);
        const sourceFile = relativePath.replace(".i18n.json", "");
        const content = fs.readJsonSync(file);

        Object.entries(content).forEach(([key, value]) => {
          if (defaultMessages[key]) {
            // 记录冲突
            conflictStats[key] = (conflictStats[key] || 1) + 1;

            // 获取现有源文件列表 - 修改调用方式
            const existingSourceFiles =
              defaultMessages[key]._sourceFiles ||
              this.extractSourceFiles(defaultMessages[key].description) ||
              [];

            // 获取新文件源文件
            const newSourceFile = sourceFile;

            // 合并源文件列表（如果不存在）
            if (!existingSourceFiles.includes(newSourceFile)) {
              const updatedSourceFiles = [
                ...existingSourceFiles,
                newSourceFile,
              ];

              // 更新消息，使用干净的描述和合并的源文件列表
              defaultMessages[key] = {
                message: defaultMessages[key].message,
                description: this.cleanDescription(
                  defaultMessages[key].description
                ),
                _sourceFiles: updatedSourceFiles,
              };
            }
          } else {
            // 新消息，添加源文件引用
            const cleanDesc = this.cleanDescription(value.description);

            defaultMessages[key] = {
              message: value.message,
              description: cleanDesc,
              _sourceFiles: [sourceFile],
            };
          }
        });
      } catch (error) {
        console.error(`处理文件 ${file} 时出错:`, error.message);
      }
    });

    // 3. 保存默认语言文件 (直接替换)
    const defaultLangPath = path.join(
      tempOutputDir,
      defaultLang,
      "messages.json"
    );
    fs.ensureDirSync(path.dirname(defaultLangPath));
    fs.writeJsonSync(defaultLangPath, defaultMessages, { spaces: 2 });
    this.trackFileWrite(path.resolve(defaultLangPath));

    // 4. 处理其他语言文件
    try {
      const localeDirs = fs.existsSync(tempOutputDir)
        ? fs
            .readdirSync(tempOutputDir)
            .filter(
              (dir) =>
                fs.statSync(path.join(tempOutputDir, dir)).isDirectory() &&
                dir !== defaultLang
            )
        : [];

      localeDirs.forEach((lang) => {
        const messagesPath = path.join(tempOutputDir, lang, "messages.json");
        let existingMessages = {};

        // 读取现有翻译
        if (fs.existsSync(messagesPath)) {
          try {
            existingMessages = fs.readJsonSync(messagesPath);
          } catch (error) {
            console.error(`读取 ${lang} 翻译文件失败:`, error.message);
          }
        }

        // 创建更新后的翻译
        const updatedMessages = {};
        let translatedCount = 0;
        let totalCount = Object.keys(defaultMessages).length;

        // 修改消息处理逻辑
        Object.entries(defaultMessages).forEach(([key, value]) => {
          const sourceFiles =
            value._sourceFiles || this.extractSourceFiles(value.description);
          const cleanDesc = value.description
            ? this.cleanDescription(value.description)
            : "";

          if (existingMessages[key] && existingMessages[key].message) {
            const isUntranslated =
              existingMessages[key]._untranslated === true ||
              (existingMessages[key]._untranslated === undefined &&
                existingMessages[key].message === value.message);

            // 保留现有翻译，更新干净的描述，源文件单独存储
            updatedMessages[key] = {
              message: existingMessages[key].message,
              description: cleanDesc,
              _sourceFiles: sourceFiles,
              ...(isUntranslated ? { _untranslated: true } : {}),
            };

            if (!isUntranslated) {
              translatedCount++;
            }
          } else {
            // 新消息，标记为未翻译
            updatedMessages[key] = {
              message: value.message,
              description: cleanDesc,
              _sourceFiles: sourceFiles,
              _untranslated: true,
            };
          }
        });

        // 保存更新后的翻译
        fs.ensureDirSync(path.join(tempOutputDir, lang));
        fs.writeJsonSync(messagesPath, updatedMessages, { spaces: 2 });
        this.trackFileWrite(path.resolve(messagesPath));

        // 计算翻译覆盖率
        const coverage = ((translatedCount / totalCount) * 100).toFixed(2);
        console.log(
          `${lang} 语言翻译完成率: ${coverage}% (${translatedCount}/${totalCount})`
        );
      });
    } catch (error) {
      console.error("处理其他语言文件时出错:", error.message);
    }

    // 5. 输出冲突统计
    const conflictCount = Object.keys(conflictStats).length;
    if (conflictCount > 0) {
      console.log(`\n检测到 ${conflictCount} 个重复的消息ID:`);
      Object.entries(conflictStats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([key, count]) => {
          console.log(`- ${key}: 在 ${count} 个文件中定义`);
          // 显示具体文件列表
          if (defaultMessages[key] && defaultMessages[key]._sourceFiles) {
            defaultMessages[key]._sourceFiles.forEach((file) => {
              console.log(`  • ${file}`);
            });
          }
        });
    }

    console.log(
      `\n本地化文件处理完成，共 ${Object.keys(defaultMessages).length} 条消息`
    );
  }
}

module.exports = I18nPlugin;
