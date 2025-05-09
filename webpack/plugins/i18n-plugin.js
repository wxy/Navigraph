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
      defaultLang: "zh_CN",
      // 源代码文件匹配模式 - 移除JS文件，只保留TS和HTML
      patterns: ["**/*.ts", "**/*.tsx", "**/*.html", "**/*.htm"],
      // 排除的文件或目录
      exclude: ["node_modules", "dist", "_locales"],
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

    // 缓存已扫描的消息
    this.cachedMessages = null;
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

  apply(compiler) {
    // 在编译开始前处理本地化文件
    compiler.hooks.beforeRun.tapAsync("I18nPlugin", (compilation, callback) => {
      console.log("\n开始处理本地化文件...");
      this.processSourceFiles();
      callback();
    });

    // 在监视模式下更智能地判断是否需要处理
    compiler.hooks.watchRun.tapAsync("I18nPlugin", (compilation, callback) => {
      // 首次运行时强制处理
      if (this.isFirstWatchRun) {
        console.log("\n首次监视模式启动，处理本地化文件...");
        this.isFirstWatchRun = false;
        this.processSourceFiles();
        callback();
        return;
      }

      // 获取发生变化的文件
      const changedFiles = compilation.modifiedFiles || new Set();
      let shouldProcess = false;

      // 分析变化的文件
      changedFiles.forEach((file) => {
        // 如果是插件自己写入的文件，忽略
        if (this.isRecentlyWrittenByPlugin(file)) {
          return;
        }

        // 检查是否是源代码文件
        const relativePath = path.relative(this.options.srcDir, file);
        const isSourceFile = this.options.patterns.some((pattern) => {
          // 使用glob进行匹配
          const matches = glob.sync(path.join(this.options.srcDir, pattern));
          const absolutePath = path.resolve(file);
          return matches.some(match => path.resolve(match) === absolutePath);
        });

        if (
          isSourceFile &&
          !this.options.exclude.some((dir) => relativePath.startsWith(dir))
        ) {
          shouldProcess = true;
        }
      });

      // 如果没有相关文件变化，直接跳过处理
      if (!shouldProcess) {
        callback();
        return;
      }

      console.log("\n检测到源文件变化，处理本地化消息...");
      this.processSourceFiles();
      callback();
    });
  }

  /**
   * 从源代码中扫描本地化消息
   */
  scanSourceFiles() {
    if (this.cachedMessages) {
      return this.cachedMessages;
    }

    console.log("扫描源文件中的本地化信息...");
    const messages = {};

    // 获取匹配的文件
    const allFiles = [];
    this.options.patterns.forEach((pattern) => {
      const files = glob.sync(path.join(this.options.srcDir, pattern), {
        ignore: this.options.exclude.map((dir) =>
          path.join(this.options.srcDir, dir, "**")
        ),
      });
      allFiles.push(...files);
    });

    // 去重
    const uniqueFiles = [...new Set(allFiles)];
    console.log(`找到 ${uniqueFiles.length} 个源代码文件`);

    // 扫描分类统计
    const stats = {
      ts: 0,
      html: 0,
      other: 0,
    };

    // 处理所有文件
    uniqueFiles.forEach((file) => {
      try {
        if (/\.(html|htm)$/i.test(file)) {
          this.processHtmlFile(file, messages);
          stats.html++;
        } else if (/\.(ts|tsx)$/i.test(file)) {
          this.processTypeScriptFile(file, messages);
          stats.ts++;
        } else {
          stats.other++;
        }
      } catch (error) {
        console.error(`处理文件 ${file} 时出错:`, error.message);
      }
    });

    // 处理manifest.json
    this.processManifestFile(messages);

    // 更详细的扫描统计
    console.log("\n源文件扫描统计:");
    console.log(`📊 扫描文件总数: ${uniqueFiles.length}`);
    console.log(`📄 TypeScript文件: ${stats.ts}个`);
    console.log(`🌐 HTML文件: ${stats.html}个`);
    console.log(`📦 其他文件: ${stats.other}个`);
    console.log(`📝 提取消息总数: ${Object.keys(messages).length}个`);

    // 缓存结果
    this.cachedMessages = messages;
    return messages;
  }

  /**
   * 处理TypeScript文件中的本地化消息
   */
  processTypeScriptFile(filePath, messages) {
    const content = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(this.options.srcDir, filePath);

    // 匹配 i18n('message_id', '默认消息') 格式
    const i18nCallsRegex = /i18n\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
    let match;
    let count = 0;

    while ((match = i18nCallsRegex.exec(content)) !== null) {
      const messageId = match[1];
      let defaultMessage = match[2];
      
      // 解析字符串字面量的转义字符，避免双重转义
      try {
        // 使用 JSON.parse 解析转义字符，但需要添加引号
        defaultMessage = JSON.parse(`"${defaultMessage.replace(/"/g, '\\"')}"`);
      } catch (e) {
        // 如果解析失败，使用原始匹配值
        console.warn(`无法解析消息 "${messageId}" 的转义字符: ${e.message}`);
      }
      
      count++;

      if (!messages[messageId]) {
        messages[messageId] = {
          message: defaultMessage,
          description: `从TS提取: ${relativePath}`,
          _sourceFiles: [relativePath],
        };
      } else {
        // 已存在该消息ID，添加源文件
        if (!messages[messageId]._sourceFiles) {
          messages[messageId]._sourceFiles = [];
        }
        if (!messages[messageId]._sourceFiles.includes(relativePath)) {
          messages[messageId]._sourceFiles.push(relativePath);
        }
      }
    }

    return count;
  }

  /**
   * 处理源文件并更新语言文件
   */
  processSourceFiles() {
    const defaultLang = this.options.defaultLang;
    const tempOutputDir = this.options.tempOutputDir;

    // 从源文件中提取消息
    const extractedMessages = this.scanSourceFiles();
    console.log(`从源代码中提取了 ${Object.keys(extractedMessages).length} 条消息`);

    // 处理默认语言文件
    this.updateDefaultLanguageFile(
      extractedMessages,
      defaultLang,
      tempOutputDir
    );

    // 处理其他语言文件
    this.updateOtherLanguageFiles(
      extractedMessages,
      defaultLang,
      tempOutputDir
    );
  }

  /**
   * 处理HTML文件中的本地化消息
   * @param {string} filePath - HTML文件路径
   * @param {Object} messages - 消息收集对象
   */
  processHtmlFile(filePath, messages) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const relativePath = path.relative(this.options.srcDir, filePath);

      // 1. 提取data-i18n属性
      const dataI18nRegex = /data-i18n=["']([^"']+)["']/g;
      let match;
      while ((match = dataI18nRegex.exec(content)) !== null) {
        const messageId = match[1];

        // 尝试查找元素内容作为默认消息
        const elementRegex = new RegExp(
          `data-i18n=["']${messageId}["'][^>]*>([^<]+)<`,
          "g"
        );
        const elementMatch = elementRegex.exec(content);
        let defaultMessage = elementMatch ? elementMatch[1].trim() : messageId;

        // 解析HTML中可能的字符实体
        defaultMessage = defaultMessage.replace(/&quot;/g, '"')
                                      .replace(/&apos;/g, "'")
                                      .replace(/&amp;/g, '&')
                                      .replace(/&lt;/g, '<')
                                      .replace(/&gt;/g, '>');

        if (!messages[messageId]) {
          messages[messageId] = {
            message: defaultMessage,
            description: `从HTML提取: ${relativePath}`,
            _sourceFiles: [relativePath],
          };
        } else {
          // 已存在该消息ID，添加源文件
          if (!messages[messageId]._sourceFiles) {
            messages[messageId]._sourceFiles = [];
          }
          if (!messages[messageId]._sourceFiles.includes(relativePath)) {
            messages[messageId]._sourceFiles.push(relativePath);
          }
        }
      }

      // 2. 提取HTML标签中的__MSG_*__占位符
      const msgPlaceholderRegex = /__MSG_([^_]+)__/g;
      while ((match = msgPlaceholderRegex.exec(content)) !== null) {
        const messageId = match[1];

        if (!messages[messageId]) {
          messages[messageId] = {
            message: messageId, // 使用ID作为默认消息
            description: `从HTML占位符提取: ${relativePath}`,
            _sourceFiles: [relativePath],
          };
        } else {
          // 已存在该消息ID，添加源文件
          if (!messages[messageId]._sourceFiles) {
            messages[messageId]._sourceFiles = [];
          }
          if (!messages[messageId]._sourceFiles.includes(relativePath)) {
            messages[messageId]._sourceFiles.push(relativePath);
          }
        }
      }
    } catch (error) {
      console.error(`处理HTML文件 ${filePath} 时出错:`, error.message);
    }
  }

  /**
   * 处理manifest.json文件
   */
  processManifestFile(messages) {
    const manifestPath = path.resolve("manifest.json");
    if (!fs.existsSync(manifestPath)) {
      console.log("未找到manifest.json文件");
      return;
    }

    try {
      console.log("处理manifest.json文件...");
      const content = fs.readFileSync(manifestPath, "utf8");
      const manifestJson = JSON.parse(content);

      // 读取现有的默认语言文件，用于保留翻译
      const defaultLangPath = path.join(
        this.options.tempOutputDir,
        this.options.defaultLang,
        "messages.json"
      );
      
      let existingMessages = {};
      if (fs.existsSync(defaultLangPath)) {
        try {
          existingMessages = fs.readJsonSync(defaultLangPath);
          console.log(`读取现有默认语言文件以保留manifest消息翻译`);
        } catch (error) {
          console.error(`读取默认语言文件失败:`, error.message);
        }
      }

      // 递归提取所有__MSG_*__格式的字符串
      const extractedKeys = this.extractMessagesFromObject(
        manifestJson,
        "manifest.json",
        messages,
        existingMessages // 传入现有翻译
      );
      console.log(`从manifest.json提取了${extractedKeys}个消息ID`);

      return extractedKeys;
    } catch (error) {
      console.error("处理manifest.json时出错:", error.message);
      return 0;
    }
  }

  /**
   * 从对象中递归提取__MSG_*__格式的消息ID
   */
  extractMessagesFromObject(obj, source, messages, existingMessages = {}) {
    let count = 0;

    if (typeof obj === "string") {
      // 检查字符串是否包含__MSG_*__格式
      const msgRegex = /__MSG_([^_]+)__/g;
      let match;

      while ((match = msgRegex.exec(obj)) !== null) {
        const messageId = match[1];
        count++;

        if (!messages[messageId]) {
          // 检查是否存在现有翻译，优先使用现有翻译
          if (existingMessages[messageId] && existingMessages[messageId].message) {
            messages[messageId] = {
              message: existingMessages[messageId].message, // 使用现有翻译
              description: existingMessages[messageId].description || `用于manifest.json中`,
              _sourceFiles: [source],
            };
          } else {
            messages[messageId] = {
              message: messageId, // 对于manifest.json，没有默认值时才使用ID
              description: `用于manifest.json中`,
              _sourceFiles: [source],
            };
          }
        } else {
          // 已存在该消息ID，添加源文件
          if (!messages[messageId]._sourceFiles) {
            messages[messageId]._sourceFiles = [];
          }
          if (!messages[messageId]._sourceFiles.includes(source)) {
            messages[messageId]._sourceFiles.push(source);
          }
        }
      }
    } else if (obj && typeof obj === "object") {
      // 递归处理对象或数组
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          count += this.extractMessagesFromObject(obj[key], source, messages, existingMessages);
        }
      }
    }

    return count;
  }

  /**
   * 更新默认语言文件
   */
  updateDefaultLanguageFile(extractedMessages, defaultLang, tempOutputDir) {
    const defaultLangPath = path.join(
      tempOutputDir,
      defaultLang,
      "messages.json"
    );
    let existingMessages = {};

    // 尝试读取现有的默认语言文件
    if (fs.existsSync(defaultLangPath)) {
      try {
        existingMessages = fs.readJsonSync(defaultLangPath);
        console.log(`读取现有默认语言文件: ${defaultLangPath}`);
      } catch (error) {
        console.error(`读取默认语言文件失败:`, error.message);
      }
    }

    // 创建更新后的消息对象，保持原有顺序
    const updatedMessages = {};
    const extractedKeys = new Set(Object.keys(extractedMessages));
    const existingKeys = new Set(Object.keys(existingMessages));

    // 统计对象
    const stats = {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      total: Object.keys(extractedMessages).length,
    };

    // 记录变更详情
    const changes = {
      added: [],
      updated: [],
      removed: [],
    };

    // 创建已更新消息的集合，用于其他语言文件的处理
    this.updatedMessageIds = new Set();

    // 1. 首先处理现有条目，保持它们的顺序
    Object.keys(existingMessages).forEach((key) => {
      if (extractedKeys.has(key)) {
        // 检查消息是否有变化
        const isUpdated =
          existingMessages[key].message !== extractedMessages[key].message;

        updatedMessages[key] = {
          message: extractedMessages[key].message,
          // 保留现有description，如果不存在则使用提取的description
          description:
            existingMessages[key].description || extractedMessages[key].description,
        };

        extractedKeys.delete(key); // 从待处理列表中移除

        if (isUpdated) {
          stats.updated++;
          changes.updated.push({
            key,
            oldValue: existingMessages[key].message,
            newValue: extractedMessages[key].message,
          });
          // 记录已更新的消息ID，用于处理其他语言文件
          this.updatedMessageIds.add(key);
        } else {
          stats.unchanged++;
        }
      } else {
        stats.removed++;
        changes.removed.push({
          key,
          value: existingMessages[key].message,
        });
      }
    });

    // 2. 处理新增条目
    stats.added = extractedKeys.size;

    // 为每个新消息找到一个适当的位置
    extractedKeys.forEach((key) => {
      changes.added.push({
        key,
        value: extractedMessages[key].message,
        sources: extractedMessages[key]._sourceFiles || [],
      });

      // 获取该消息出现的源文件
      const sourcesForKey = extractedMessages[key]._sourceFiles || [];

      // 尝试找到最相关的现有条目
      let bestPosition = -1;
      let bestScore = -1;

      Object.keys(updatedMessages).forEach((existingKey, index) => {
        // 尝试查找相关条目基于源文件的相似度
        if (extractedMessages[existingKey] && extractedMessages[existingKey]._sourceFiles) {
          const sourcesForExisting = extractedMessages[existingKey]._sourceFiles;
          
          // 计算源文件重叠度
          let overlapScore = 0;
          sourcesForKey.forEach((source) => {
            if (sourcesForExisting.includes(source)) overlapScore++;
          });

          // 如果找到更好的匹配，更新位置
          if (overlapScore > bestScore) {
            bestScore = overlapScore;
            bestPosition = index;
          }
        }
      });

      // 如果找到了相关条目，在其附近插入新条目
      if (bestPosition !== -1) {
        // 创建临时对象，保留前面的条目
        const temp = {};
        Object.keys(updatedMessages).forEach((existingKey, index) => {
          temp[existingKey] = updatedMessages[existingKey];

          // 在找到的位置后插入新条目
          if (index === bestPosition) {
            temp[key] = {
              message: extractedMessages[key].message,
              description: extractedMessages[key].description,
            };
          }
        });

        // 更新消息对象
        Object.assign(updatedMessages, temp);
      } else {
        // 如果没有找到相关条目，附加到末尾
        updatedMessages[key] = {
          message: extractedMessages[key].message,
          description: extractedMessages[key].description,
        };
      }
    });

    // 保存更新后的默认语言文件
    fs.ensureDirSync(path.dirname(defaultLangPath));
    fs.writeJsonSync(defaultLangPath, updatedMessages, { spaces: 2 });
    this.trackFileWrite(path.resolve(defaultLangPath));

    console.log(
      `\n${defaultLang} 默认语言文件已更新，共 ${Object.keys(updatedMessages).length} 条消息`
    );

    // 打印详细变更报告
    console.log(`\n${defaultLang} 默认语言文件更新报告:`);
    console.log(`✅ 总消息数: ${Object.keys(updatedMessages).length}`);
    console.log(`➕ 新增: ${stats.added}`);
    console.log(`🔄 更新: ${stats.updated}`);
    console.log(`🗑️ 删除: ${stats.removed}`);
    console.log(`⏺️ 未变: ${stats.unchanged}`);

    // 显示详细变更信息
    if (changes.added.length > 0) {
      console.log("\n📝 新增消息:");
      changes.added.forEach((item) => {
        console.log(`  ➕ ${item.key}: "${item.value}"`);
        if (item.sources && item.sources.length > 0) {
          console.log(`    📄 来源: ${item.sources.join(", ")}`);
        }
      });
    }

    if (changes.updated.length > 0) {
      console.log("\n📝 更新消息:");
      changes.updated.forEach((item) => {
        console.log(`  🔄 ${item.key}:`);
        console.log(`    ❌ 旧值: "${item.oldValue}"`);
        console.log(`    ✅ 新值: "${item.newValue}"`);
      });
    }

    if (changes.removed.length > 0) {
      console.log("\n📝 删除消息:");
      changes.removed.forEach((item) => {
        console.log(`  🗑️ ${item.key}: "${item.value}"`);
      });
    }
  }

  /**
   * 更新其他语言文件
   */
  updateOtherLanguageFiles(extractedMessages, defaultLang, tempOutputDir) {
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

      if (localeDirs.length === 0) {
        console.log("未找到其他语言文件");
        return;
      }

      // 读取默认语言文件作为参考
      const defaultLangPath = path.join(
        tempOutputDir,
        defaultLang,
        "messages.json"
      );
      const defaultMessages = fs.existsSync(defaultLangPath)
        ? fs.readJsonSync(defaultLangPath)
        : extractedMessages;

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

        // 创建更新后的翻译，保持与默认语言相同的顺序
        const updatedMessages = {};
        let translatedCount = 0;
        let totalCount = Object.keys(defaultMessages).length;

        // 统计对象
        const stats = {
          kept: 0,
          keptUntranslated: 0,
          markedUntranslated: 0, // 新统计：被标记为未翻译的已翻译条目
          newUntranslated: 0,
          removed: 0,
          total: 0,
        };

        // 按默认语言文件的顺序处理消息
        Object.keys(defaultMessages).forEach((key) => {
          if (existingMessages[key]) {
            const wasTranslated =
              existingMessages[key]._untranslated === undefined ||
              existingMessages[key]._untranslated === false;

            // 检查该消息在默认语言中是否被更新
            const wasUpdatedInDefault = this.updatedMessageIds && this.updatedMessageIds.has(key);

            updatedMessages[key] = {
              message: existingMessages[key].message,
              description:
                existingMessages[key].description ||
                defaultMessages[key].description,
            };

            // 如果在默认语言中被更新，则在此语言中标记为未翻译
            // 但保留原有翻译内容，使译者可以检查并确认翻译
            if (wasUpdatedInDefault && wasTranslated) {
              updatedMessages[key]._untranslated = true;
              stats.markedUntranslated++;
            } 
            // 处理其他情况
            else if (!wasTranslated) {
              updatedMessages[key]._untranslated = true;
              stats.keptUntranslated++;
            }
            else {
              stats.kept++;
              translatedCount++;
            }
          } else {
            // 新条目，标记为未翻译
            stats.newUntranslated++;
            updatedMessages[key] = {
              message: defaultMessages[key].message,
              description: defaultMessages[key].description,
              _untranslated: true,
            };
          }
        });

        // 检查删除的条目
        Object.keys(existingMessages).forEach((key) => {
          if (!defaultMessages[key]) {
            stats.removed++;
          }
        });

        stats.total = Object.keys(updatedMessages).length;

        // 保存更新后的翻译
        fs.ensureDirSync(path.join(tempOutputDir, lang));
        fs.writeJsonSync(messagesPath, updatedMessages, { spaces: 2 });
        this.trackFileWrite(path.resolve(messagesPath));

        // 计算翻译覆盖率
        const coverage = ((translatedCount / totalCount) * 100).toFixed(2);

        // 打印简化的统计信息
        console.log(`\n${lang} 语言文件更新报告:`);
        console.log(`✅ 总消息数: ${stats.total}`);
        console.log(`✓ 已翻译: ${stats.kept}`);
        console.log(
          `⚠️ 未翻译: ${
            stats.keptUntranslated + stats.newUntranslated + stats.markedUntranslated
          } (新增: ${stats.newUntranslated}, 已有: ${stats.keptUntranslated}, 需重新翻译: ${stats.markedUntranslated})`
        );
        console.log(`🗑️ 删除过时条目: ${stats.removed}`);
        console.log(`📊 翻译完成率: ${coverage}%`);

        // 翻译提示
        if (stats.newUntranslated + stats.keptUntranslated + stats.markedUntranslated > 10) {
          console.log(
            `\n⚠️ ${lang}有${
              stats.newUntranslated + stats.keptUntranslated + stats.markedUntranslated
            }个未翻译条目，建议尽快完成翻译`
          );
        }
      });
    } catch (error) {
      console.error("处理其他语言文件时出错:", error.message);
    }
  }
}

module.exports = I18nPlugin;
