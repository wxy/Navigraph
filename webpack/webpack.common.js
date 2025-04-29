const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
  entry: {
    // 后台脚本入口
    background: path.resolve(__dirname, '..', 'src', 'background', 'background.ts'),
    // 内容脚本入口
    navigraph: path.resolve(__dirname, '..', 'src', 'content', 'navigraph.ts'),
    // 扩展页面入口
    content: path.resolve(__dirname, '..', 'src', 'content', 'index.ts'),
    // 选项页面入口
    options: path.resolve(__dirname, '..', 'src', 'options', 'options.ts')
  },
  module: {
    rules: [
      // CSS处理
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
      // 图片处理
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.js']  // 当导入.js文件时，也尝试查找.ts文件
    },
    // 别名配置，方便导入
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
      '@lib': path.resolve(__dirname, '..', 'src', 'lib'),
      '@types': path.resolve(__dirname, '..', 'src', 'types'),
    },
  },
  plugins: [
    new CleanWebpackPlugin({
      cleanStaleWebpackAssets: false, // 防止删除复制的文件
    }),
    // 复制静态资源
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'images', to: 'images' },
        // 添加content目录下的HTML文件，排除index.html
        { 
          from: 'src/content/*.html', 
          to: 'content/[name][ext]',
          noErrorOnMissing: true,
          globOptions: {
            ignore: ['**/index.html'] // 排除index.html，让HtmlWebpackPlugin处理它
          }
        },
        { 
          from: 'src/content/*.js', 
          to: 'content/[name][ext]',
          noErrorOnMissing: true 
        },
        // 添加content/styles目录
        { 
          from: 'src/content/styles', 
          to: 'content/styles',
          noErrorOnMissing: true 
        },
        // 添加options/styles目录
        { 
          from: 'src/options/styles', 
          to: 'options/styles',
          noErrorOnMissing: true 
        },
        // 增加这一行，将 locales 文件夹原样拷贝到 dist
        { 
          from: '_locales', 
          to: '_locales', 
          noErrorOnMissing: true 
        }
      ]
    }),
    // 生成选项页面HTML
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '..', 'src', 'options', 'index.html'),
      filename: 'options/index.html',
      chunks: ['options'],
      cache: false,
    }),
    // 如果有扩展弹出页面HTML，也需要处理
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '..', 'src', 'content', 'index.html'),
      filename: 'content/index.html',
      chunks: ['content'],
      cache: false,
      inject: false, // 如果HTML中已手动引入JS，设为false避免重复注入
    }),
  ],
  output: {
    // 使用函数根据入口名动态决定输出路径
    filename: (pathData) => {
      // 对于内容脚本特殊处理
      if (pathData.chunk.name === 'navigraph') {
        return 'content/navigraph.js';  // 将navigraph输出到content目录下
      }
      // 其他文件保持原有输出方式
      return '[name]/[name].js';
    },
    path: path.resolve(__dirname, '..', 'dist'),
    clean: true,
  },
  optimization: {
    runtimeChunk: false,  // 不生成runtime chunk
    splitChunks: {
      chunks: 'async',    // 仅为异步模块分割代码
      cacheGroups: {
        vendors: false,   // 禁用默认的vendors缓存组
        default: false    // 禁用默认缓存组
      }
    }
  }
};