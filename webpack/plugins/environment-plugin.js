// webpack/plugins/environment-plugin.js
class EnvironmentPlugin {
  constructor(options = {}) {
    this.isDev = options.isDev || false;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('EnvironmentPlugin', (compilation) => {
      // 在webpack构建时替换环境变量
      compilation.hooks.processAssets.tap(
        {
          name: 'EnvironmentPlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        (assets) => {
          // 为生产环境修改版本号格式
          const manifestAsset = assets['manifest.json'];
          if (manifestAsset) {
            let content = manifestAsset.source().toString();
            const manifest = JSON.parse(content);
            
            // 开发版本使用0.x.x.x格式，生产版本使用x.x.x格式
            if (this.isDev) {
              // 确保开发版本号以0开头
              if (!manifest.version.startsWith('0.')) {
                manifest.version = '0.' + manifest.version;
              }
            } else {
              // 生产版本移除开头的0.
              if (manifest.version.startsWith('0.')) {
                manifest.version = manifest.version.substring(2);
              }
            }
            
            assets['manifest.json'] = {
              source: () => JSON.stringify(manifest, null, 2),
              size: () => JSON.stringify(manifest, null, 2).length,
            };
          }
        }
      );
    });
  }
}

module.exports = EnvironmentPlugin;