const path = require('path');
const HtmlWebPackPlugin = require("html-webpack-plugin");
const CopyPlugin = require('copy-webpack-plugin');


module.exports = {
  entry: './src/index.js',
  target: "web",
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devServer: {
    contentBase: './dist',
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.s[ac]ss$/i,
        use: [
          'style-loader',
          'css-loader',
          'sass-loader',
        ],
      },
      {
        test: /\.css$/i,
        use: [
          'style-loader',
          'css-loader',
        ],
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        use:
        [
          'file-loader',
        ],
      },
      {
        test: /\.(woff(2)?|ttf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
        use: [
          {
            loader: 'file-loader',
            options: {
              name: '[name].[ext]',
              outputPath: 'fonts/'
            }
          }
        ]
      },
    ],
  },
  plugins: [
    new HtmlWebPackPlugin({
        template: './src/index.html',
        filename: './index.html'
    }),
    new CopyPlugin({
      patterns: [
        { from: './src/example-data', to: './example-data' },
        { from: './src/opencv.js', to: './opencv.js' },
    ]}),
  ]
};
