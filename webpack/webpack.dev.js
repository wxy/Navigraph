const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const EnvironmentPlugin = require('./plugins/environment-plugin');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true, // 开发环境也使用transpileOnly提高速度
            // 使用默认的tsconfig.json
          }
        },
        exclude: /node_modules/,
      },
    ],
  },
  watchOptions: {
    poll: 1000, // 检查文件变化的间隔(毫秒)
    ignored: /node_modules/,
  },
  plugins: [
    new EnvironmentPlugin({ isDev: true }),
  ],
});