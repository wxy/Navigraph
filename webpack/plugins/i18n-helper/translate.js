const fs = require('fs').promises;
const axios = require('axios');
const path = require('path');

// 加载API密钥
async function loadApiKey() {
  try {
    const credentialsPath = path.join(__dirname, 'google-credentials.json');
    const keyData = await fs.readFile(credentialsPath, 'utf8');
    return JSON.parse(keyData).apiKey;
  } catch (error) {
    console.error('无法加载API密钥:', error.message);
    process.exit(1);
  }
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
          source: 'zh-CN',
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
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        const currentPath = path ? `${path}.${key}` : key;
        
        // 判断是否需要翻译
        const needsTranslation = 
          (key === 'message' || key === 'description') && 
          typeof value === 'string' && 
          value.trim() !== '' &&
          (obj._untranslated === true || (key === 'description' && !('_untranslated' in obj)));
        
        if (needsTranslation) {
          textsToTranslate.push(value);
          pathMap.push({
            path: currentPath,
            key: key,
            originalValue: value
          });
        } else if (typeof value === 'object' && value !== null) {
          collect(value, currentPath);
        }
      }
    }
  }
  
  collect(obj);
  return { textsToTranslate, pathMap };
}

// 主函数
async function main() {
  try {
    // 加载API密钥
    const apiKey = await loadApiKey();
    
    // 处理输入文件路径
    const inputFile = process.argv[2];
    if (!inputFile) {
      console.error('请提供输入文件路径');
      console.log('用法: node translate.js /path/to/messages.json');
      process.exit(1);
    }
    
    // 从文件路径提取目标语言
    const targetLang = extractLanguageCode(inputFile);
    console.log(`从路径提取的目标语言: ${targetLang}`);
    
    // 读取JSON文件
    console.log(`读取文件: ${inputFile}`);
    const jsonData = await fs.readFile(inputFile, 'utf8');
    const jsonObj = JSON.parse(jsonData);
    
    // 收集需要翻译的文本
    const { textsToTranslate, pathMap } = collectTexts(jsonObj);
    console.log(`找到 ${textsToTranslate.length} 个需要翻译的文本`);
    
    if (textsToTranslate.length === 0) {
      console.log('没有需要翻译的文本，跳过翻译过程');
      process.exit(0);
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
      const { path, key, originalValue } = pathMap[i];
      const translation = translations[i];
      
      if (translation) {
        // 用点表示法找到并更新字段
        const pathParts = path.split('.');
        let current = jsonObj;
        
        for (let j = 0; j < pathParts.length - 1; j++) {
          current = current[pathParts[j]];
        }
        
        const lastKey = pathParts[pathParts.length - 1];
        
        // 只有当翻译结果与原文不同时才更新
        if (translation !== originalValue) {
          current[lastKey] = translation;
          modifiedCount++;
          
          // 更新_untranslated字段
          if (key === 'message') {
            current['_untranslated'] = false;
          }
        }
      }
    }
    
    console.log(`修改了 ${modifiedCount} 条翻译`);
    
    // 写入结果到原文件
    console.log(`写入结果到原文件: ${inputFile}`);
    await fs.writeFile(
      inputFile, 
      JSON.stringify(jsonObj, null, 2),
      'utf8'
    );
    
    console.log('处理完成!');
  } catch (error) {
    console.error(`出错: ${error.message}`);
    process.exit(1);
  }
}

// 执行主函数
main();