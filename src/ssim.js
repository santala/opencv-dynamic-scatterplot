/**
 * Implements Bezkrovny's ssim-specific logic.
 *
 * Refactor of the TypeScript SSIM implementation by Bezkrovny, modified to match the api of ssim.js
 * and reduce duplication.
 *
 * The original work is available at: https://github.com/igor-bezkrovny/image-quantization which is
 * itself a port of the Java SSIM implementation available at https://github.com/rhys-e/structural-similarity
 * both under MIT license
 *
 */


export class SSIM {
    constructor() {
        this.windowSize = 16;
        this.maxImageLongEdge = 512;
        this.maxImageShortEdge = 256;

        this.scaledSrc1 =  new cv.Mat(this.maxImageLongEdge, this.maxImageShortEdge, cv.CV_8U);
        this.scaledSrc2 =  new cv.Mat(this.maxImageLongEdge, this.maxImageShortEdge, cv.CV_8U);

        this.tmpWindow1 = new cv.Mat(this.windowSize, this.windowSize, cv.CV_32F);
        this.tmpWindow2 = new cv.Mat(this.windowSize, this.windowSize, cv.CV_32F);

        const maxWindowCount =  Math.floor(this.maxImageLongEdge / this.windowSize) *
            Math.floor(this.maxImageShortEdge / this.windowSize);

        this.mat0 = new cv.Mat(1, maxWindowCount, cv.CV_32F);
        this.mat1 = new cv.Mat(1, maxWindowCount, cv.CV_32F);
        this.mat2 = new cv.Mat(1, maxWindowCount, cv.CV_32F);
        this.mat3 = new cv.Mat(1, maxWindowCount, cv.CV_32F);
        this.mat4 = new cv.Mat(1, maxWindowCount, cv.CV_32F);
        this.mat5 = new cv.Mat(1, maxWindowCount, cv.CV_32F);
        this.mat6 = new cv.Mat(1, maxWindowCount, cv.CV_32F);
    }


    downscale(src1, src2) {
        // Scale the images down so that
        // either the longer edge is at maximum this.maxImageLongEdge
        // or the shorter edge is at maximum this.maxImageShortEdge
        const { cols: width, rows: height } = src1;
        const factor = Math.min(
            this.maxImageLongEdge / Math.max(width, height),
            this.maxImageShortEdge / Math.min(width, height)
        );
        if (factor < 1) {
            const { scaledSrc1, scaledSrc2 } = this;
            if ((width > width) !== (scaledSrc1.cols > scaledSrc1.rows)) {
                cv.transpose(scaledSrc1, scaledSrc1);
                cv.transpose(scaledSrc2, scaledSrc2);
            }
            const size = new cv.Size(width * factor, height * factor);
            cv.resize(src1, scaledSrc1, size);
            cv.resize(src2, scaledSrc2, size);
            return [scaledSrc1, scaledSrc2];
        } else {
            // No need to downscale
            return [src1, src2];
        }
    }

    computeMeanSSIM(src1, src2) {
        // Reduce need to resolve pointers
        const cvAdd = cv.add;
        const cvMean = cv.mean;
        const cvMultiply = cv.multiply;
        const CV_32F = cv.CV_32F;

        const k1 = 0.01;
        const k2 = 0.03;
        const bitDepth = 8;

        const L = 2 ** bitDepth - 1;
        const c1 = (k1 * L) ** 2;
        const c2 = (k2 * L) ** 2;

        //if (src1.cols > this.maxImageSize || src1.rows > this.maxImageSize) {
        [src1, src2] = this.downscale(src1, src2);
        //}
        const imgWidth = src1.cols;
        const imgHeight = src1.rows;

        const windowSize = this.windowSize;

        const ssimWidth = Math.floor(imgWidth / windowSize);
        const ssimHeight = Math.floor(imgHeight / windowSize);
        const windowCount = ssimWidth * ssimHeight;

        const quarterSSIM = this.mat0.colRange(0, windowCount);
        const mat1 = this.mat1.colRange(0, windowCount);
        const mat2 = this.mat2.colRange(0, windowCount);
        const mat3 = this.mat3.colRange(0, windowCount);
        const mat4 = this.mat4.colRange(0, windowCount);
        const mat5 = this.mat5.colRange(0, windowCount);
        const mat6 = this.mat6.colRange(0, windowCount);


        const mat1Arr = mat1.data32F;
        const mat2Arr = mat2.data32F;
        const mat3Arr = mat3.data32F;
        const mat4Arr = mat4.data32F;
        const mat5Arr = mat5.data32F;

        const tmpWindow1 = this.tmpWindow1;
        const tmpWindow2 = this.tmpWindow2;
        const rect = { width: windowSize, height: windowSize, x: 0, y: 0 };
        let window1Variance = tmpWindow1.roi({ width: windowSize, height: windowSize, x: 0, y: 0 });
        let window2Variance = tmpWindow2.roi({ width: windowSize, height: windowSize, x: 0, y: 0 });

        //console.time("Loop");
        for (let i = 0, y0 = 0, y1 = imgHeight % windowSize; y1 <= imgHeight; y0 = y1, y1 += windowSize) {
            if (y1 == 0) {
                continue;
            }
            for (let x0 = 0, x1 = imgWidth % windowSize; x1 <= imgWidth; x0 = x1, x1 += windowSize, i++) {
                if (x1 == 0) {
                    i--;
                    continue;
                }
                const width = x1 - x0;
                const height = y1 - y0;

                rect.x = x0;
                rect.y = y0;
                rect.width = x1 - x0;
                rect.height = y1 - y0;
                const window1 = src1.roi(rect);
                const window2 = src2.roi(rect);

                if (window1Variance.cols !== width || window2Variance.rows !== height) {
                    // Need to update temp matrix sizes
                    window1Variance.deleteLater();
                    window2Variance.deleteLater();
                    rect.x = 0;
                    rect.y = 0;
                    window1Variance = tmpWindow1.roi(rect);
                    window2Variance = tmpWindow2.roi(rect);
                }

                const window1Mean = cvMean(window1)[0];
                const window2Mean = cvMean(window2)[0];
                // meanA: means from windows of image 1
                // meanB: means from windows of image 2
                mat1Arr[i] = window1Mean;
                mat2Arr[i] = window2Mean;

                window1.convertTo(window1Variance, CV_32F, 1, -window1Mean);
                window2.convertTo(window2Variance, CV_32F, 1, -window2Mean);

                // meanCovar: means of covariances
                mat3Arr[i] = window1Variance.dot(window2Variance) / (width * height);

                // Square variances
                cvMultiply(window1Variance, window1Variance, window1Variance);
                cvMultiply(window2Variance, window2Variance, window2Variance);

                // meanVarSq*: means of variances squared
                mat4Arr[i] = cvMean(window1Variance)[0];
                mat5Arr[i] = cvMean(window2Variance)[0];

                window1.deleteLater();
                window2.deleteLater();
            }
        }
        //console.timeEnd("Loop");
        //console.time("Math");

        cvMultiply(mat1, mat2, mat6);           // mat6 = meanA * meanB
        cvMultiply(mat1, mat1, mat1);           // mat1 = meanA^2
        cvMultiply(mat2, mat2, mat2);           // mat2 = meanB^2

        cvAdd(mat1, mat2, mat1);                // mat1 = meanA^2 + meanB^2
        mat1.convertTo(mat1, cv.CV_32F, 1, c1); // mat1 = meanA^2 + meanB^2 + c1

        cvAdd(mat4, mat5, mat4);                // mat4 = meanVarSqA + meanVarSqB
        mat4.convertTo(mat4, cv.CV_32F, 1, c2); // mat4 = meanVarSqA + meanVarSqB + c2
        cvMultiply(mat1, mat4, mat1);           // mat1 = (meanA^2 + meanB^2 + c1) * (meanVarSqA + meanVarSqB + c2)

        mat6.convertTo(mat6, cv.CV_32F, 1, c1/2); // mat6 = meanA * meanB + c1/2
        mat3.convertTo(mat3, cv.CV_32F, 1, c2/2); // mat3 = meanCovar + c2/2

        cvMultiply(mat6, mat3, mat6);             // mat6 = (meanA * meanB + c1/2) * (meanCovar + c2/2)

        // ssim/4
        // = ((meanA * meanB + c1/2) * (meanCovar + c2/2)) / ((meanA^2 + meanB^2 + c1) * (meanVarSqA + meanVarSqB + c2))
        cv.divide(mat6, mat1, quarterSSIM);

        // Mean structural similarity
        const mssim = 4 * cvMean(quarterSSIM)[0];
        quarterSSIM.deleteLater();

        return mssim;
    }
}