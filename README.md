# OpenCV.js-based Scatterplot Renderer and Optimizer

This is a demo of the algorithm described in the paper [Fast Design Space Rendering of Scatterplots](https://dx.doi.org/10.2312/evs.20201058) by Simo Santala, Antti Oulasvirta, and Tino Weinkauf. 

[Online demo](http://graphmetrics.research.comnet.aalto.fi)

The source code is licensed under the MIT license.

## Installation

Tested with Node.js version 12.18.0.

<pre>
npm i
</pre>

## Running

<pre>
npm run start
</pre>

## Source Code

### index.html

Template that imports opencv.js. index.js is imported automatically by webpack.

### index.js

Main React application that initializes the renderer.

### data-import.js

React GUI and functionality to import CSV data.

### scatterplots.js

React GUI for displaying and interacting with the scatterplot.

### renderer.js

Scatterplot rendering algorithm.

### optimizer.js

Scatterplot optimization algorithm. Implements the algorithm of [Micallef et al. (2017)](https://userinterfaces.aalto.fi/scatterplot_optimization/).

### ssim.js

OpenCV implementation of Structural Similarity. This is a refactoring of the [SSIM implementation of ssim.js](https://github.com/obartra/ssim) which is a refactoring of the [Typescript SSIM implementation by Bezkrovny](https://github.com/igor-bezkrovny/image-quantization).

### opencv.js

Compiled [OpenCV.js library](https://docs.opencv.org/3.4/d5/d10/tutorial_js_root.html).

### config.json

Configuration parameters for the application.

### example-data/

Example data sets from [Hurricane Isabel data](https://www.earthsystemgrid.org/dataset/isabeldata.html) produced by the Weather Research and Forecast (WRF) model, courtesy of NCAR, and the U.S. National Science Foundation (NSF).
