import cov from "compute-covariance";
import { SSIM } from "./ssim";

const cannyLow = .1 * 255;
const cannyHigh = .2 * 255;
const pcaEllipseNTSD = 1.5;

const designToHash = JSON.stringify;
const designFromHash = JSON.parse;

function findNonZero8U(mat) {
    const w = mat.cols;
    const h = mat.rows;
    const data = mat.data;
    const x = [];
    const y = [];
    for (let i = 0, r = 0; r < h; r++) {
        for (let c = 0; c < w; c++, i++) {
            if (data[i] > 0) {
                x.push(c);
                y.push(r);
            }
        }
    }
    return { x, y };
}

function arraySum(arr) {
    return arr.reduce((sum, val) => sum + val);
}

function arrayDot(arr1, arr2) {
    const l = arr1.length;
    const tmp = Array(l);

    for (let i = 0; i < l; i++) {
        tmp[i] = arr1[i] * arr2[i];
    }

    return arraySum(tmp);
}

function crop(src, w, h, x = 0, y = 0) {
    const tmp1 = src.colRange(x, x + w);
    const tmp2 = tmp1.rowRange(y, y + h);
    tmp1.delete();
    return tmp2;
}

function getCovarianceEllipseProps({ x, y }) {
    let covMat = cov( x, y );
    covMat = cv.matFromArray(covMat.length, covMat.length, cv.CV_32F, covMat.flat());
    const eigenValues = new cv.Mat(2, 1, cv.CV_32F);
    const eigenVectors = new cv.Mat(2, 2, cv.CV_32F);
    cv.eigen(covMat, eigenValues, eigenVectors);


    // Get the largest eigenvector pointing into the upper hemisphere
    const maxEigenValue = Math.max(...eigenValues.data32F);
    const maxEigenPos = eigenValues.data32F.indexOf(maxEigenValue);
    const maxEigenVector = eigenVectors.rowRange(maxEigenPos, maxEigenPos + 1);

    if (maxEigenVector.data32F[1] < 0) {
        maxEigenVector.convertTo(maxEigenVector, cv.CV_32F, -1);
    }

    // Original code:
    // alpha = np.degrees(math.acos(np.dot(np.array([1,0]), largest_eigenvec)))
    const angle = Math.acos(maxEigenVector.data32F[0]) * 180 / Math.PI;
    const majorAxis = pcaEllipseNTSD * Math.sqrt(eigenValues.data32F[0]);
    const minorAxis = pcaEllipseNTSD * Math.sqrt(eigenValues.data32F[1]);

    covMat.delete();
    return { angle, majorAxis, minorAxis };
}


export default class ScatterplotOptimizer {
    constructor(renderer) {
        this.renderer = renderer;

        this.measureCount = 10;

        this.desiredOpacity = .5;
        this.desiredContrast = .5;

        this.tmpMat1 = { rows: null, cols: null, delete: () => {} };
        this.tmpMat2 = { rows: null, cols: null, delete: () => {} };

        this.results;
        this.dataCovEllipseProps;

        this.minOutlierSeparability;
        this.maxOutlierSeparability;

        this.minClassSeparability;
        this.maxClassSeparability;

        this.ssim = new SSIM();

        this.reset();
    }

    reset() {
        console.log("Clearing evaluation results");
        this.results = new Map();
        this.dataCovEllipseProps = new Map();
        this.minOutlierSeparability = 1;
        this.maxOutlierSeparability = 0;
        this.minClassSeparability = 1;
        this.maxClassSeparability = 0;
    }

    delete() {
        this.tmpMat1.delete();
        this.tmpMat2.delete();
    }

    getPerceivedEllipseProps(imageMat) {

        const tmp = this.tmpMat1;

        const downSamplingFactor = .25;
        const downscaledWidth = Math.round(downSamplingFactor * imageMat.cols);
        const downscaledHeight = Math.round(downSamplingFactor * imageMat.rows);
        const tmpScaled = crop(tmp, downscaledWidth, downscaledHeight);
        cv.resize(imageMat, tmpScaled, new cv.Size(downscaledWidth, downscaledHeight));
        cv.GaussianBlur(tmpScaled, tmpScaled, new cv.Size(5, 5), 1);

        cv.Canny(tmpScaled, tmpScaled, cannyLow, cannyHigh);

        if (cv.countNonZero(tmpScaled) === 0) {
            return false;
        }

        const { x, y } = findNonZero8U(tmpScaled);
        tmpScaled.delete();
        const h = imageMat.rows;
        // TODO: Performance may be improved by not flipping the data points now, but flipping the ellipse later.
        for (let i = 0; i < y.length; i++) {
            y[i] = h - y[i];
        }

        return getCovarianceEllipseProps({ x, y });
    }

    getDataCovEllipseProps(label) {
        if (!this.dataCovEllipseProps.has(label)) {
            this.dataCovEllipseProps.set(label, getCovarianceEllipseProps(this.renderer.data.get(label)));
        }
        return this.dataCovEllipseProps.get(label);
    }

    evaluate(design, weights) {
        // TODO: add support for saving results from several data sets
        const key = designToHash(design);
        if (!this.results.has(key)) {
            const { width, height } = design;

            const renderer = this.renderer;
            const { markers, data, plots } = renderer;
            let n = renderer.n;

            if (data.has(-1)) {
                n -= data.get(-1).x.length; // Discount outliers
            }

            // Create continuous matrices for measures
            if (this.tmpMat1.cols !== width || this.tmpMat1.rows !== height) {
                this.tmpMat1.delete();
                this.tmpMat2.delete();
                this.tmpMat1 = new cv.Mat(width, height, cv.CV_8U);
                this.tmpMat2 = new cv.Mat(width, height, cv.CV_8U);
            }
            const tmpMat1 = this.tmpMat1;
            const tmpMat2 = this.tmpMat2;

            // Quality measures developed by Micallef et al.
            // https://userinterfaces.aalto.fi/scatterplot_optimization/
            const measures = new Array(this.measureCount);

            // PERCEIVED CORRELATION

            let angleError = 0,
                axisRatioError = 0;

            plots.forEach((plot, label) => {
                if (label !== -1) {
                    const weight = data.get(label).x.length / n;

                    const perceivedEllipseProps = this.getPerceivedEllipseProps(plot.getImage(design));

                    let groupAngleError = 1,
                        groupAxisRatioError = 1;

                    if (!!perceivedEllipseProps) {
                        const dataEllipseProps = this.getDataCovEllipseProps(label);

                        groupAngleError = Math.abs(perceivedEllipseProps.angle - dataEllipseProps.angle)
                        console.assert(groupAngleError <= 180, groupAngleError);
                        groupAngleError = Math.min(groupAngleError, 180 - groupAngleError) / 90;

                        groupAxisRatioError = Math.abs(dataEllipseProps.minorAxis / dataEllipseProps.majorAxis
                            - perceivedEllipseProps.minorAxis / perceivedEllipseProps.majorAxis);

                    }
                    angleError += weight * groupAngleError;
                    axisRatioError += weight * groupAxisRatioError;
                }
            });

            // Eα: Perceived covariance ellipse angle error
            measures[0] = angleError;

            // Er: Perceived covariance ellipse axes length ratio error
            measures[1] = axisRatioError;

            // IMAGE QUALITY

            renderer.getAlphaChannel(design).copyTo(tmpMat1);

            const alphaNonZeroCount = cv.countNonZero(tmpMat1);
            const markerNonZeroCount = cv.countNonZero(markers[design.markerType].getMat(design.markerSize));
            const markerAlphaSum = design.markerOpacity * markerNonZeroCount;

            let alphaSum = 0;
            let alphaSquaredSum = 0;

            const alphaArr = tmpMat1.data;
            for (let i = 0; i < alphaArr.length; i++) {
                const val = alphaArr[i];
                alphaSum += val;
                alphaSquaredSum += val * val;
            }

            // Iμ: Average pixel opacity
            measures[2] = alphaSum / alphaNonZeroCount / 255;
            // Iσ: Image contrast
            measures[3] = Math.sqrt(
                Math.abs(alphaSquaredSum / 65025 - alphaNonZeroCount * measures[2] * measures[2])
                / alphaNonZeroCount
            );

            // Iμ_: Difference to desired average opacity
            measures[4] = Math.abs(this.desiredOpacity - measures[2]);

            // Iσ: Difference to desired contrast
            measures[5] = Math.abs(this.desiredContrast - measures[3]);

            // Point Overlapping
            measures[6] = 1 - alphaNonZeroCount / (markerNonZeroCount * n);

            // Overplotting
            measures[7] = 1 - alphaSum / (markerAlphaSum * n);

            // CLASS & OUTLIER SEPARATION

            let classSeparability = 0;
            let outlierSeparability = 0;

            if (plots.size > 1) {

                // Label -1 denotes outliers
                const ssim = this.ssim;

                if (plots.has(-1)) {
                    renderer.getAlphaChannelWithout(design, -1).copyTo(tmpMat2);
                    //const start = new Date().getTime();
                    outlierSeparability = ssim.computeMeanSSIM(tmpMat1, tmpMat2);
                    //const performance = new Date().getTime() - start;
                    //const error = Math.abs(matSSIM(tmpMat1, tmpMat2) - outlierSeparability);
                    //console.assert( error < .01, error);
                    //console.log("Performance", performance);
                }

                if (!plots.has(-1) || plots.size > 2) {
                    plots.forEach((plot, label) => {
                        if (label !== -1) {
                            const weight = data.get(label).x.length / n;
                            renderer.getAlphaChannelWithout(design, label).copyTo(tmpMat2);
                            const groupClassSeparability = ssim.computeMeanSSIM(tmpMat1, tmpMat2);
                            classSeparability += weight * groupClassSeparability;
                        }
                    });
                }
            }

            // Class separability
            measures[8] = classSeparability;

            // Outlier separability
            measures[9] = outlierSeparability;


            // Limit to 0–1 range
            for (let i = 0; i < measures.length; i++) {
                measures[i] = Math.min(Math.max( measures[i], 0), 1);
            }
            this.minClassSeparability = Math.min(this.minClassSeparability, classSeparability);
            this.maxClassSeparability = Math.max(this.maxClassSeparability, classSeparability);

            this.minOutlierSeparability = Math.min(this.minOutlierSeparability, outlierSeparability);
            this.maxOutlierSeparability = Math.max(this.maxOutlierSeparability, outlierSeparability);

            this.results.set(key, measures);
        }

        const measures = [...this.results.get(key)];
        const classSeparabilityRange = this.maxClassSeparability - this.minClassSeparability;
        if (classSeparabilityRange > 0) {
            measures[8] = (measures[8] - this.minClassSeparability) / classSeparabilityRange;
        }
        const outlierSeparabilityRange = this.maxOutlierSeparability - this.minOutlierSeparability;
        if (outlierSeparabilityRange > 0) {
            measures[9] = (measures[9] - this.minOutlierSeparability) / outlierSeparabilityRange;
        }
        const score = !!weights ? arrayDot(measures, weights) : arraySum(measures);
        return { measures, score };
    }

    findBest(weights) {
        let bestDesignHash = null;
        let bestScore = Number.MAX_VALUE;

        const classSeparabilityRange = this.maxClassSeparability - this.minClassSeparability;
        const outlierSeparabilityRange = this.maxOutlierSeparability - this.minOutlierSeparability;

        this.results.forEach((measures, designHash) => {
            measures = [...measures];
            if (classSeparabilityRange > 0) {
                measures[8] = (measures[8] - this.minClassSeparability) / classSeparabilityRange;
            }
            if (outlierSeparabilityRange > 0) {
                measures[9] = (measures[9] - this.minOutlierSeparability) / outlierSeparabilityRange;
            }
            const score = arrayDot(measures, weights);
            if (score < bestScore) {
                bestDesignHash = designHash;
                bestScore = score;
            }
        });

        console.log("outlierSeparabilityRange", outlierSeparabilityRange);

        return { design: designFromHash(bestDesignHash), score: bestScore };
    }

    optimize(designs, weights) {
        for (let i = 0; i < designs.length; i++) {
            this.evaluate(designs[i]);
        }
        return this.findBest(weights);
    }
}