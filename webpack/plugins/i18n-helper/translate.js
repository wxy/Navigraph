const fs = require('fs').promises;
const axios = require('axios');
const path = require('path');
const { existsSync, readFileSync } = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });  // 加载 .env 文件

// 从环境变量加载API密钥
async function loadApiKey() {
  try {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      throw new Error('环境变量 GOOGLE_TRANSLATE_API_KEY 未设置');
    }
    return apiKey;
  } catch (error) {
    console.error('无法加载API密钥:', error.message);
    process.exit(1);
  }
}

// 确定默认语言：尝试多种方式获取
function determineDefaultLanguage() {
  // 1. 命令行参数中指定的默认语言 (--default-lang=xx_XX)
  const cmdArgs = process.argv;
  for (let i = 0; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (arg.startsWith('--default-lang=')) {
      return arg.split('=')[1];
    }
    if (arg === '--default-lang' && i + 1 < cmdArgs.length) {
      return cmdArgs[i + 1];
    }
  }
  
  // 2. 环境变量中指定的默认语言
  if (process.env.DEFAULT_LOCALE) {
    return process.env.DEFAULT_LOCALE;
  }
  
  // 3. 尝试从项目根目录的manifest.json获取
  try {
    // 尝试不同的相对路径查找manifest.json
    const possiblePaths = [
      'manifest.json',
      '../manifest.json',
      '../../manifest.json',
      '../../../manifest.json'
    ];
    
    for (const manifestPath of possiblePaths) {
      const fullPath = path.resolve(__dirname, manifestPath);
      if (existsSync(fullPath)) {
        const manifest = JSON.parse(readFileSync(fullPath, 'utf8'));
        if (manifest.default_locale) {
          console.log(`从 ${fullPath} 中读取到默认语言: ${manifest.default_locale}`);
          return manifest.default_locale;
        }
      }
    }
  } catch (error) {
    console.log('未能从manifest.json读取默认语言');
  }
  
  // 4. 使用硬编码默认值
  console.log('使用默认值: zh_CN');
  return 'zh_CN';
}

// 从文件路径中提取语言代码
function extractLanguageCode(filePath) {
  // 匹配_locales/xx_XX/messages.json模式
  const localeMatch = filePath.match(/_locales\/([a-z]{2}(?:_[A-Z]{2})?)\//);
  if (localeMatch && localeMatch[1]) {
    // 转换为API格式 (zh_TW -> zh-TW)
    return localeMatch[1].replace('_', '-');
  }
  
  // 匹配xx_XX/messages.json模式
  const simpleMatch = filePath.match(/([a-z]{2}(?:_[A-Z]{2})?)\/messages\.json/);
  if (simpleMatch && simpleMatch[1]) {
    return simpleMatch[1].replace('_', '-');
  }
  
  // 默认值
  console.warn('无法从文件路径提取语言代码，使用默认值zh-HK');
  return 'zh-HK';
}

// 批量翻译文本
async function batchTranslate(texts, apiKey, targetLang, batchSize = 50) {
  console.log(`目标语言: ${targetLang}`);
  
  // 获取源语言（默认语言的API格式）
  let sourceLang = determineDefaultLanguage().replace('_', '-');
  // 某些语言需要特殊处理
  if (sourceLang === 'zh-CN') {
    sourceLang = 'zh-CN';  // 简体中文
  } else if (sourceLang === 'zh-TW' || sourceLang === 'zh-HK') {
    sourceLang = 'zh-TW';  // 繁体中文
  }
  
  console.log(`源语言: ${sourceLang}`);
  
  const batches = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  const results = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`处理批次 ${i+1}/${batches.length}，包含 ${batch.length} 个文本`);
    
    try {
      const response = await axios({
        method: 'post',
        url: `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
        data: {
          q: batch,
          source: sourceLang,
          target: targetLang,
          format: 'text'
        }
      });
      
      const translations = response.data.data.translations;
      results.push(...translations.map(t => t.translatedText));
      
      // 避免API限制，添加短暂延迟
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`批次翻译失败:`, error.response?.data?.error?.message || error.message);
      // 添加错误占位符
      batch.forEach(() => results.push(null));
      
      // 遇到错误时增加更长的延迟
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return results;
}

// 收集JSON对象中所有需要翻译的文本
function collectTexts(obj) {
  const textsToTranslate = [];
  const pathMap = [];
  
  function collect(obj, path = '') {
    if (obj === null || typeof obj !== 'object') return;
    
    // 检查当前对象是否被标记为未翻译
    if (obj._untranslated === true && obj.message) {
      // 只翻译message字段，忽略description
      textsToTranslate.push(obj.message);
      pathMap.push({
        path: path ? `${path}.message` : 'message',
        parentPath: path, // 记录父路径以便更新_untranslated标记
        originalValue: obj.message
      });
    }
    
    // 继续递归搜索子对象
    for (const key in obj) {
      if (obj.hasOwnProperty(key) && typeof obj[key] === 'object' && obj[key] !== null) {
        const currentPath = path ? `${path}.${key}` : key;
        collect(obj[key], currentPath);
      }
    }
  }
  
  collect(obj);
  return { textsToTranslate, pathMap };
}

// 处理单个语言文件
async function processFile(filePath, apiKey) {
  try {
    // 从文件路径提取目标语言
    const targetLang = extractLanguageCode(filePath);
    console.log(`\n处理文件: ${filePath} (语言: ${targetLang})`);
    
    // 读取JSON文件
    const jsonData = await fs.readFile(filePath, 'utf8');
    const jsonObj = JSON.parse(jsonData);
    
    // 收集需要翻译的文本
    const { textsToTranslate, pathMap } = collectTexts(jsonObj);
    console.log(`找到 ${textsToTranslate.length} 个需要翻译的message字段`);
    
    if (textsToTranslate.length === 0) {
      console.log('没有需要翻译的文本，跳过翻译过程');
      return 0;
    }
    
    // 批量翻译
    console.log('开始翻译...');
    const translations = await batchTranslate(textsToTranslate, apiKey, targetLang);
    
    // 统计翻译结果
    const successful = translations.filter(t => t !== null).length;
    console.log(`翻译完成: ${successful}/${translations.length} 成功`);
    
    // 将翻译结果写回JSON对象
    let modifiedCount = 0;
    for (let i = 0; i < pathMap.length; i++) {
      const { path, parentPath, originalValue } = pathMap[i];
      const translation = translations[i];
      
      if (translation && translation !== originalValue) {
        // 更新翻译
        const pathParts = path.split('.');
        let current = jsonObj;
        
        for (let j = 0; j < pathParts.length - 1; j++) {
          current = current[pathParts[j]];
        }
        
        const lastKey = pathParts[pathParts.length - 1];
        current[lastKey] = translation;
        
        // 移除_untranslated标记
        const parentParts = parentPath.split('.');
        let parent = jsonObj;
        
        for (const part of parentParts) {
          if (part) parent = parent[part];
        }
        
        // 只有成功翻译后才移除未翻译标记
        if (parent && parent._untranslated) {
          parent._untranslated = false;
          modifiedCount++;
        }
      }
    }
    
    console.log(`修改了 ${modifiedCount} 条翻译`);
    
    // 写入结果到原文件
    await fs.writeFile(
      filePath, 
      JSON.stringify(jsonObj, null, 2),
      'utf8'
    );
    
    console.log(`文件 ${path.basename(filePath)} 处理完成!`);
    return modifiedCount;
  } catch (error) {
    console.error(`处理文件 ${filePath} 时出错:`, error.message);
    return 0;
  }
}

// 处理整个_locales目录
async function processLocalesDir(localesDir, apiKey) {
  console.log(`处理本地化目录: ${localesDir}`);
  
  // 获取默认语言
  const defaultLang = determineDefaultLanguage();
  console.log(`默认语言: ${defaultLang}`);
  
  try {
    // 获取所有语言目录
    const langDirs = await fs.readdir(localesDir);
    
    // 跟踪总修改计数
    let totalModified = 0;
    
    for (const langDir of langDirs) {
      // 跳过默认语言
      if (langDir === defaultLang) {
        console.log(`跳过默认语言: ${langDir}`);
        continue;
      }
      
      const langPath = path.join(localesDir, langDir);
      const stat = await fs.stat(langPath);
      
      if (!stat.isDirectory()) {
        continue;
      }
      
      // 处理此语言的messages.json文件
      const messagesFile = path.join(langPath, 'messages.json');
      try {
        // 检查文件是否存在
        await fs.access(messagesFile);
        
        // 处理文件
        const modifiedCount = await processFile(messagesFile, apiKey);
        totalModified += modifiedCount;
      } catch (error) {
        console.log(`语言 ${langDir} 没有messages.json文件，跳过`);
      }
    }
    
    console.log(`\n所有语言文件处理完成，共修改了 ${totalModified} 条翻译`);
  } catch (error) {
    console.error(`处理本地化目录时出错:`, error.message);
  }
}

// 检查路径是文件还是目录
async function checkPath(inputPath) {
  try {
    const stats = await fs.stat(inputPath);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  } catch (error) {
    console.error(`检查路径时出错:`, error.message);
    return { isFile: false, isDirectory: false };
  }
}

// 显示帮助信息
function showHelp() {
  console.log(`
翻译工具使用方法:
  node translate.js [选项] <文件路径或_locales目录路径>

选项:
  --default-lang=xx_XX   指定默认语言 (例如: zh_CN, en, fr)
  --help                 显示此帮助信息

例子:
  node translate.js _locales                     # 处理所有语言文件
  node translate.js --default-lang=en _locales   # 使用英语作为默认语言
  node translate.js _locales/fr/messages.json    # 只处理法语文件
  `);
}

// 主函数
async function main() {
  try {
    // 检查帮助选项
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      showHelp();
      return;
    }
    
    // 加载API密钥
    const apiKey = await loadApiKey();
    
    // 获取输入路径（跳过选项）
    let inputPath = null;
    for (const arg of process.argv.slice(2)) {
      if (!arg.startsWith('--')) {
        inputPath = arg;
        break;
      }
    }
    
    if (!inputPath) {
      console.error('请提供输入路径');
      showHelp();
      process.exit(1);
    }
    
    // 检查路径类型
    const pathInfo = await checkPath(inputPath);
    
    if (pathInfo.isFile) {
      // 处理单个文件
      await processFile(inputPath, apiKey);
    } else if (pathInfo.isDirectory) {
      // 检测是否是_locales目录或包含_locales的目录
      const dirName = path.basename(inputPath);
      
      if (dirName === '_locales') {
        // 直接处理_locales目录
        await processLocalesDir(inputPath, apiKey);
      } else {
        // 检查是否包含_locales子目录
        const localesPath = path.join(inputPath, '_locales');
        const localesInfo = await checkPath(localesPath);
        
        if (localesInfo.isDirectory) {
          await processLocalesDir(localesPath, apiKey);
        } else {
          console.error(`目录 ${inputPath} 不是_locales目录，也不包含_locales子目录`);
          process.exit(1);
        }
      }
    } else {
      console.error(`路径 ${inputPath} 不存在或既不是文件也不是目录`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`出错: ${error.message}`);
    process.exit(1);
  }
}

// 执行主函数
main();