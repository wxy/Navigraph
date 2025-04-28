const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const EnvironmentPlugin = require('./plugins/environment-plugin');
const path = require('path');

module.exports = merge(common, {
  mode: 'production',
  devtool: false, // 生产环境禁用源映射
  module: {
    rules: [
      // 覆盖TypeScript处理
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true, // 跳过类型检查，只进行转译
            configFile: path.resolve(__dirname, '..', 'tsconfig.prod.json') // 使用生产环境配置
          }
        },
        exclude: /node_modules/
      },
      // CSS处理
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name]/styles/[name].css',
    }),
    new EnvironmentPlugin({ isDev: false })
  ],
  optimization: {
// 生产环境优化
    minimize: true,
    usedExports: true, // 树摇
    moduleIds: 'deterministic', // 稳定的模块ID，有助于缓存
  }
});