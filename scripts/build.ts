import esbuild from 'esbuild';
import { copy } from 'esbuild-plugin-copy';

// 主构建配置
const config: esbuild.BuildOptions = {
  entryPoints: [
    'src/background/tab-manager.ts',
    'src/popup/popup.ts'
  ],
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  outdir: 'dist',
  plugins: [
    copy({
      assets: [
        { from: './assets/*', to: './dist/assets' },
        { from: './src/popup/index.html', to: './dist/popup' }
      ]
    })
  ],
  loader: {
    '.png': 'file',
    '.svg': 'text'
  }
};

// 开发模式监听
if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
} else {
  esbuild.build(config);
}