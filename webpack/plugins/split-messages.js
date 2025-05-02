#!/usr/bin/env node
/**
 * 消息文件拆分工具 - 安全版本
 * 将集中式messages.json拆分为多个源文件对应的.i18n.json文件
 */
const fs = require("fs-extra");
const path = require("path");

// 配置
const SOURCE_FILE = path.resolve("./_locales/zh_CN/messages.json");
const SOURCE_DIR = path.resolve("./");  // 使用项目根目录
const DEFAULT_LANG = "zh_CN";
const LOG_DETAILS = true;
const BACKUP_ORIGINAL = false; // 备份原始消息文件
const DRY_RUN = false; // 设为true进行测试，不写入文件

/**
 * 验证文件路径是否安全 (防止路径遍历攻击)
 */
function isPathSafe(filePath, baseDir) {
  const resolvedPath = path.resolve(baseDir, filePath);
  return resolvedPath.startsWith(baseDir);
}

/**
 * 规范化文件路径
 */
function normalizePath(filePath) {
  // 处理Windows和Unix路径差异
  return filePath.replace(/\\/g, "/");
}

/**
 * 提取消息描述中的文件路径
 */
function extractFilePaths(description) {
  // 匹配以@开始，后面跟着非空白字符的序列
  const matches = description?.match(/@([^\s]+)/g) || [];
  return matches.map((match) => normalizePath(match.substring(1)));
}

/**
 * 解决路径重叠问题的通用函数
 */
function buildTargetPath(baseDir, filePath) {
  // 直接将文件路径拼接到项目根目录
  return path.join(baseDir, `${filePath}.i18n.json`);
}

/**
 * 主函数
 */
async function main() {
  console.log("开始拆分消息文件...");

  // 创建备份
  if (BACKUP_ORIGINAL && !DRY_RUN) {
    const backupFile = `${SOURCE_FILE}.backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    try {
      await fs.copy(SOURCE_FILE, backupFile);
      console.log(`已创建备份: ${backupFile}`);
    } catch (error) {
      console.warn(`创建备份失败: ${error.message}`);
    }
  }

  // 读取消息文件
  let messages;
  try {
    messages = await fs.readJson(SOURCE_FILE);
    console.log(`成功加载消息文件，共 ${Object.keys(messages).length} 条消息`);
  } catch (error) {
    console.error(`无法读取消息文件: ${error.message}`);
    process.exit(1);
  }

  // 按文件路径分组
  const messagesByFile = {};
  const messageStats = {
    total: Object.keys(messages).length,
    assigned: 0,
    multipleFiles: 0,
    noSource: 0,
    uniqueFiles: 0,
    unsafePaths: 0,
  };

  // 用于跟踪多文件引用的消息
  const multiFileMessages = {};
  const unsafePaths = [];

  // 处理每个消息
  Object.entries(messages).forEach(([key, value]) => {
    const description = value.description || "";
    const filePaths = extractFilePaths(description);

    if (filePaths.length > 0) {
      messageStats.assigned++;

      if (filePaths.length > 1) {
        messageStats.multipleFiles++;
        multiFileMessages[key] = filePaths;
      }

      // 为每个文件添加消息
      filePaths.forEach((filePath) => {
        // 验证路径安全性
        if (!isPathSafe(filePath, SOURCE_DIR)) {
          messageStats.unsafePaths++;
          unsafePaths.push(filePath);
          console.warn(`警告: 不安全的文件路径: ${filePath} (消息ID: ${key})`);
          return; // 跳过不安全路径
        }

        if (!messagesByFile[filePath]) {
          messagesByFile[filePath] = {};
          messageStats.uniqueFiles++;
        }

        // 复制消息，移除文件路径标记
        messagesByFile[filePath][key] = {
          message: value.message,
          description: description.replace(/@[^\s]+/g, "").trim() || key,
        };
      });
    } else {
      // 没有源文件信息
      messageStats.noSource++;
      if (!messagesByFile["_unknown"]) {
        messagesByFile["_unknown"] = {};
      }
      messagesByFile["_unknown"][key] = {
        message: value.message,
        description: description || key,
      };
    }
  });

  // 生成i18n.json文件
  const outputFiles = {};
  let filesCreated = 0;
  let filesSkipped = 0;

  for (const [filePath, fileMessages] of Object.entries(messagesByFile)) {
    if (filePath === "_unknown") continue;

    // 目标路径处理
    const targetFile = buildTargetPath(SOURCE_DIR, filePath);
    const targetDir = path.dirname(targetFile);

    // 添加文件存在性检查
    const sourceFilePath = path.join(SOURCE_DIR, filePath);
    const sourceFileExists = await fs.pathExists(sourceFilePath);

    if (!sourceFileExists) {
      console.warn(`源文件不存在: ${sourceFilePath}，消息将被归入未确定类别`);
      
      // 将相关消息移到未确定类别
      if (!messagesByFile["_unknown"]) {
        messagesByFile["_unknown"] = {};
      }
      
      // 合并消息到未确定类别
      Object.entries(fileMessages).forEach(([key, value]) => {
        messagesByFile["_unknown"][key] = value;
      });
      
      // 从原分类中删除
      delete messagesByFile[filePath];
      continue;  // 跳过此文件路径的处理
    }

    try {
      // 检查文件是否已存在
      const fileExists = await fs.pathExists(targetFile);
      const actionWord = fileExists ? "更新" : "创建";

      if (!DRY_RUN) {
        // 确保目录存在
        await fs.ensureDir(targetDir);

        // 写入文件
        await fs.writeJson(targetFile, fileMessages, { spaces: 2 });
      }

      const messageCount = Object.keys(fileMessages).length;
      outputFiles[filePath] = messageCount;
      filesCreated++;

      if (LOG_DETAILS) {
        console.log(
          `已${DRY_RUN ? "模拟" : ""}${actionWord} ${targetFile} (${messageCount} 条消息)`
        );
      }
    } catch (error) {
      console.error(`创建文件失败 ${targetFile}: ${error.message}`);
      filesSkipped++;
    }
  }

  // 处理未分配消息
  if (
    messagesByFile["_unknown"] &&
    Object.keys(messagesByFile["_unknown"]).length > 0
  ) {
    const unassignedFile = "./unassigned-messages.i18n.json";

    if (!DRY_RUN) {
      await fs.writeJson(unassignedFile, messagesByFile["_unknown"], {
        spaces: 2,
      });
    }

    console.log(
      `已${DRY_RUN ? "模拟" : ""}创建未分配消息文件: ${unassignedFile} (${
        Object.keys(messagesByFile["_unknown"]).length
      } 条消息)`
    );
  }

  // 输出多文件引用的消息信息，使用级联列表
  if (Object.keys(multiFileMessages).length > 0) {
    console.log("\n多文件引用的消息:");
    Object.entries(multiFileMessages).forEach(([key, files]) => {
      console.log(`- ${key}:`);
      files.forEach((file) => {
        console.log(`  • ${file}`);
      });
    });
  }

  // 如果存在不安全路径，输出警告
  if (unsafePaths.length > 0) {
    console.log("\n警告: 检测到不安全的文件路径");
    unsafePaths.forEach((path) => console.log(`- ${path}`));
  }

  // 输出统计信息
  console.log("\n===== 统计信息 =====");
  console.log(`总消息数: ${messageStats.total}`);
  console.log(
    `已分配到源文件的消息: ${messageStats.assigned} (${(
      (messageStats.assigned / messageStats.total) *
      100
    ).toFixed(1)}%)`
  );
  console.log(`被多个文件引用的消息: ${messageStats.multipleFiles}`);
  console.log(`未找到源文件的消息: ${messageStats.noSource}`);
  console.log(`涉及的源文件数量: ${messageStats.uniqueFiles}`);
  console.log(
    `${DRY_RUN ? "模拟" : ""}创建的.i18n.json文件数量: ${filesCreated}`
  );
  console.log(`跳过的文件数量: ${filesSkipped}`);
  console.log(`不安全的文件路径: ${messageStats.unsafePaths}`);
  console.log("=====================");

  if (DRY_RUN) {
    console.log("\n这是一次测试运行，没有实际写入文件。");
    console.log("要执行实际操作，请将DRY_RUN设置为false");
  }
}

// 执行主函数
main().catch((error) => {
  console.error("执行过程中发生错误:", error);
  process.exit(1);
});
