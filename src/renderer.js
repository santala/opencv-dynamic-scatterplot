// TODO: share temp matrices across all PointOverlap instances

function getInvertedAlphaLUT(maxSize = 65536) {
    const lookupTables = [];
    for (let a = 0; a < 256; a++) {
        let lookupTable = new Uint8Array(maxSize);
        lookupTable.fill(0);
        let lookupValue = -1;
        for (let v = 0; v < maxSize; v++) {
            lookupValue = Math.round(255 * Math.pow(1-a/255, v));
            lookupTable[v] = lookupValue;
            if (lookupValue === 0) {
                break;
            }
        }
        lookupTables.push(Uint8Array.from(lookupTable));
    }
    return lookupTables;
}

function LUT(src, dst, lookupTable) {
    const srcData = src.data16U;
    const dstData = dst.data;

    if (dst.isContinuous()) {
        for (let i=0; i < dstData.length; i++) {
            dstData[i] = lookupTable[srcData[i]];
        }
    } else {
        for (let x = 0; x < dst.cols; x++) {
            for (let y = 0; y < dst.rows; y++) {
                const srcPtr = src.ucharPtr(y, x);
                const dstPtr = dst.ucharPtr(y, x);
                dstPtr[0] = lookupTable[srcPtr[0]];
            }
        }
    }

    return dst;
}

function crop(src, w, h, x = 0, y = 0) {
    const rect = new cv.Rect(x, y, w, h);
    //const tmp1 = src.colRange(x, x + w);
    //const tmp2 = tmp1.rowRange(y, y + h);
    //tmp1.delete();
    //return tmp2;
    return src.roi(rect);
}

function continuousCrop(src, w, h) {
    const srcWidth = src.cols;
    const dstLength = w * h;
    const rowsFromSrc = Math.ceil(dstLength / srcWidth);
    const tmp = src.rowRange(0, rowsFromSrc);
    tmp.cols = w;
    tmp.rows = h;
    return tmp;

}

export class PointOverlap {
    constructor({ maxWidth, maxHeight }) {
        this.maxWidth = maxWidth;
        this.maxHeight = maxHeight;

        this._hd = new cv.Mat(maxHeight, maxWidth, cv.CV_16U);
        this._scaled = new cv.Mat(maxHeight, maxWidth, cv.CV_16U);
        this._view = {};

        this._tmp1 = new cv.Mat(maxHeight, maxWidth, cv.CV_64F);
        this._tmp2 = new cv.Mat(maxHeight, maxWidth, cv.CV_16U);

        this._width = -1;
        this._height = -1;
    }

    addPoints({ x, y, xMin, yMin, xMax, yMax }) {
        console.assert(x.length === y.length);

        const { _hd } = this;

        x = cv.matFromArray(1, x.length, cv.CV_32F, x);
        y = cv.matFromArray(1, y.length, cv.CV_32F, y);

        x.convertTo(x, cv.CV_32F, 1, -xMin); // Subtract minX
        x.convertTo(x, cv.CV_32S, (_hd.cols - 1) / (xMax - xMin), 0); // Scale to image width
        y.convertTo(y, cv.CV_32F, 1, -yMin); // Subtract minY
        y.convertTo(y, cv.CV_32F, -1, 1); // Flip y-axis
        y.convertTo(y, cv.CV_32S, (_hd.rows - 1) / (yMax - yMin), 0); // Scale to image height

        const xData = x.data32S;
        const yData = y.data32S;

        for (let i = 0; i < xData.length; i++) {
            _hd.ucharPtr(yData[i], xData[i])[0]++;
        }

        x.delete();
        y.delete();
        this._width = -1; // Triggers redraw
    }

    resetPoints() {
        this._hd.setTo([0, 0, 0, 0]);
        this._width = -1; // Triggers redraw
    }

    delete() {
        [this._hd, this._scaled, this._view, this._tmp1, this._tmp2].forEach(m => m.delete());
    }

    get({ width, height }) {
        const { _width, _height } = this;
        if (width !== _width || height !== _height) {
            this._scale({ width, height });
        }
        return this._view;
    }

    _scale({ width, height }) {
        const { _hd, _scaled, _tmp1, _tmp2 } = this;
        // Update view size
        let { _view } = this;
        if (!!_view.delete) {
            _view.delete();
        }
        _view = crop(_scaled, width, height);
        this._view = _view;

        // Scale point overlap
        const srcHeight = _hd.rows;
        const srcWidth = _hd.cols;

        const dstWidth = Math.min(width, srcWidth);
        const dstHeight = Math.min(height, srcHeight);

        const scaleX = srcWidth / dstWidth;
        const scaleY = srcHeight / dstHeight;

        const colIndices = Uint16Array.from([...Array(dstWidth + 1).keys()].map(x => Math.round(x * scaleX)));
        const rowIndices = Uint16Array.from([...Array(dstHeight + 1).keys()].map(y => Math.round(y * scaleY)));

        let intermediateOverlap64F = crop(_tmp1, dstWidth, srcHeight);

        for (let c = 0; c + 1 < colIndices.length; c++) {
            const _src = _hd.colRange(colIndices[c], colIndices[c + 1]);
            const _dst = intermediateOverlap64F.col(c);
            cv.reduce(_src, _dst, 1, cv.REDUCE_SUM, cv.CV_64F);
            _src.delete();
            _dst.delete();
        }
        const intermediateOverlap16U = crop(_tmp2, dstWidth, srcHeight);
        intermediateOverlap64F.convertTo(intermediateOverlap16U, cv.CV_16U);
        intermediateOverlap64F.delete();
        intermediateOverlap64F = crop(_tmp1, dstWidth, dstHeight);

        for (let r = 0; r + 1 < rowIndices.length; r++) {
            const _src = intermediateOverlap16U.rowRange(rowIndices[r], rowIndices[r + 1]);
            const _dst = intermediateOverlap64F.row(r);
            cv.reduce(_src, _dst, 0, cv.REDUCE_SUM, cv.CV_64F);
            _src.delete();
            _dst.delete();
        }

        intermediateOverlap64F.convertTo(_view, cv.CV_16U);
        intermediateOverlap64F.delete();
        intermediateOverlap16U.delete();

        this._width = width;
        this._height = height;
    }
}

export class MonochromePlot {
    constructor({ maxWidth, maxHeight, markers, maxMarkerSize }) {

        this.inkLUT = getInvertedAlphaLUT();

        this._markers = markers;

        let maxMarkerWidth = 0;
        let maxMarkerHeight = 0;
        Object.values(markers).forEach(marker => {
            const { width, height } = marker.getDimensions(maxMarkerSize);
            maxMarkerWidth = Math.max(maxMarkerWidth, width);
            maxMarkerHeight = Math.max(maxMarkerHeight, height);
        });

        // With the largest marker size, leave extra 10 pixels on each side
        this._paddingX = maxMarkerWidth + 20;
        this._paddingY = maxMarkerHeight + 20;

        this.pointOverlap = new PointOverlap({ maxWidth, maxHeight }); // TODO: apply padding

        this._overlap = new cv.Mat(maxHeight, maxWidth, cv.CV_16U);
        this._img = new cv.Mat(maxHeight, maxWidth, cv.CV_8U);
        this._imgF = new cv.Mat(maxHeight, maxWidth, cv.CV_32F);

        this._imgView = { deleteLater: () => {}};
        this._imgFView = { deleteLater: () => {}};

        this.currentDesign = null;
    }

    setPoints({ x, y, xMin, yMin, xMax, yMax }) {
        this.pointOverlap.resetPoints();
        this.pointOverlap.addPoints({ x, y, xMin, yMin, xMax, yMax });
        this.currentDesign = null;
    }

    delete() {
        [
            this._overlap,
            this._img,
            this._imgF,
            this._imgView,
            this._imgFView,
        ].filter(m => !!m.delete).forEach(m => m.delete());
    }

    _updateOverlapAndImage(design) {
        const { width, height, markerType, markerSize } = design;
        const markerOffsets = this.getMarkerOffsets(this._markers[markerType], markerSize);

        const overlapView = crop(this._overlap, width, height);

        const w = width - this._paddingX;
        const h = height - this._paddingY;
        const pointOverlap = this.pointOverlap.get({ width: w, height: h});

        overlapView.setTo([0, 0, 0, 0]);

        for (let i = 0; i < markerOffsets.length; i++) {
             const [y, x] = markerOffsets[i];
             const dstView = crop(overlapView, w, h, x, y);
             cv.add(dstView, pointOverlap, dstView);
             dstView.deleteLater();
        }

        overlapView.deleteLater();

        this._updateImage(design);
    }

    _updateImage(design) {
        const { height, markerOpacity } = design;
        // NOTE: LUT is fastest on continuous matrices, so we crop only the height, and not the width
        const src = this._overlap.rowRange(0, height);
        const dst = this._img.rowRange(0, height);
        LUT(src, dst, this.inkLUT[markerOpacity]);
        src.deleteLater();
        dst.deleteLater();
    }

    getImage(design) {
        this._imgView.deleteLater();
        this._imgView = crop(this._img, design.width, design.height);

        const { width, height, markerType, markerSize, markerOpacity } = design;
        const current = this.currentDesign || {};

        if (width !== current.width || height !== current.height
            || markerType !== current.markerType || markerSize !== current.markerSize) {

            this._updateOverlapAndImage(design);

        } else if (markerOpacity !== current.markerOpacity) {

            this._updateImage(design);

        }

        this.currentDesign = design;

        return this._imgView;
    }

    getImageF(design) {
        this._imgFView.deleteLater();
        this._imgFView = crop(this._imgF, design.width, design.height);

        this.getImage(design).convertTo(this._imgFView, cv.CV_32F, 1./255);

        return this._imgFView;
    }

    getMarkerOffsets(marker, size) {
        const mat = marker.getMat(size);
        const { width: markerWidth, height: markerHeight } = marker.getDimensions(size);
        const markerData = mat.data;
        const width = mat.cols;
        const offsetX = Math.floor((this._paddingX - markerWidth) / 2);
        const offsetY = Math.floor((this._paddingY - markerHeight) / 2);

        const opaque = [];
        let x, y;
        for (let j = 0; j < markerData.length; j++) {
            if (markerData[j] / 255. >= .5) {
                y = Math.floor(j / width) + offsetX;
                x = (j % width) + offsetY;
                opaque.push([y, x]);
            }
        }

        return opaque;
    }
}

export class MultiClassPlot {
    constructor({ maxWidth, maxHeight, markers, maxMarkerSize }) {
        this.data = new Map();

        this.maxWidth = maxWidth;
        this.maxHeight = maxHeight;
        this.markers = markers;
        this.maxMarkerSize = maxMarkerSize;
        this.n = 0;

        this._R = new cv.Mat(maxHeight, maxWidth, cv.CV_8U);
        this._G = new cv.Mat(maxHeight, maxWidth, cv.CV_8U);
        this._B = new cv.Mat(maxHeight, maxWidth, cv.CV_8U);
        this._A = new cv.Mat(maxHeight, maxWidth, cv.CV_8U);
        this._Awo = new cv.Mat(maxHeight, maxWidth, cv.CV_8U);
        this._Mono = new cv.Mat(maxHeight, maxWidth, cv.CV_8U);
        this._RGBA = new cv.Mat(maxHeight, maxWidth, cv.CV_8UC4);
        this._RF = new cv.Mat(maxHeight, maxWidth, cv.CV_32F);
        this._GF = new cv.Mat(maxHeight, maxWidth, cv.CV_32F);
        this._BF = new cv.Mat(maxHeight, maxWidth, cv.CV_32F);
        this._AF = new cv.Mat(maxHeight, maxWidth, cv.CV_32F);
        this._tmpF = new cv.Mat(maxHeight, maxWidth, cv.CV_32F);

        this._cRGBA = crop(this._RGBA, 1, 1);
        this._cA = crop(this._A, 1, 1);
        this._cAwo = crop(this._Awo, 1, 1);

        this.plots = new Map();
        this.plotsArr = [];
    }

    setData({ data, xMin, yMin, xMax, yMax }) {
        this.data = data;
        let n = 0;

        // Reuse existing plots for new data
        const oldPlots = [...this.plots.values()];
        this.plots = new Map();

        data.forEach(({ x, y }, label) => {
            const plot = oldPlots.pop() || new MonochromePlot({
                maxWidth: this.maxWidth,
                maxHeight: this.maxHeight,
                markers: this.markers,
                maxMarkerSize: this.maxMarkerSize
            });
            plot.setPoints({ x, y, xMin, yMin, xMax, yMax });
            this.plots.set(label, plot);
            n += x.length;
        });

        this.n = n;
        // Delete old unused plots
        oldPlots.forEach(p => p.delete());

        this.plotsArr = [...this.plots.values()];
    }

    delete() {
        this._R.delete();
        this._G.delete();
        this._B.delete();
        this._A.delete();
        this._Awo.delete();
        this._Mono.delete();
        this._RGBA.delete();
        this._RF.delete();
        this._GF.delete();
        this._BF.delete();
        this._AF.delete();
        this._tmpF.delete();

        this._cRGBA.delete();
        this._cA.delete();

        this.plots.forEach(p => p.delete());
    }

    getImage(design) {
        const { width, height, colors } = design;


        this._cRGBA.deleteLater();
        this._cA.deleteLater();
        this._cRGBA = crop(this._RGBA, width, height);
        this._cA = crop(this._A, width, height);

        const
            mR = crop(this._R, width, height),
            mG = crop(this._G, width, height),
            mB = crop(this._B, width, height),
            mRF = crop(this._RF, width, height),
            mGF = crop(this._GF, width, height),
            mBF = crop(this._BF, width, height),
            mInvAF = crop(this._AF, width, height),
            mTmp = crop(this._tmpF, width, height);

        const gamma = 2.2;
        const invGamma = 1/gamma;

        mRF.setTo([0, 0, 0, 0]);    // Red
        mGF.setTo([0, 0, 0, 0]);    // Green
        mBF.setTo([0, 0, 0, 0]);    // Blue
        mInvAF.setTo([1, 1, 1, 1]); // Inverted alpha

        for (let i = 0; i < this.plotsArr.length; i++) {
            const plot = this.plotsArr[i];

            // With premultiplied alpha:
            // outA = srcA + dstA(1 - srcA)
            // outRGB = srcRGB + dstRGB(1 - srcA)
            // outR = srcR + dstR(1 - srcA)

            // b = -a+1
            // a = -b+1
            // c * a = c * (-b+1) = -bc + c

            // With gamma correction
            // outR = (dstR^2.2 * dstA + srcR^2.2 * (1 - dstA))^1/2.2
            // c^2.2 * a = c^2.2 * (-b+1) = -bc^2.2 + c^2.2

            const [r, g, b] = colors[i % colors.length].map(c => Math.pow(c, gamma));
            const imageF = plot.getImageF(design);

            // Red
            imageF.convertTo(mTmp, cv.CV_32F, -r, r); // Premultiply red
            cv.multiply(mTmp, mInvAF, mTmp);
            cv.add(mRF, mTmp, mRF);

            // Green
            imageF.convertTo(mTmp, cv.CV_32F, -g, g); // Premultiply green
            cv.multiply(mTmp, mInvAF, mTmp);
            cv.add(mGF, mTmp, mGF);

            // Blue
            imageF.convertTo(mTmp, cv.CV_32F, -b, b); // Premultiply blue
            cv.multiply(mTmp, mInvAF, mTmp);
            cv.add(mBF, mTmp, mBF);

            // Inverted alpha
            cv.multiply(mInvAF, imageF, mInvAF);

        }

        mInvAF.convertTo(mInvAF, cv.CV_32F, -1, 1); // Alpha from inverted alpha

        // Undo premultiplication
        cv.divide(mRF, mInvAF, mRF);
        cv.divide(mGF, mInvAF, mGF);
        cv.divide(mBF, mInvAF, mBF);

        // Gamma correction
        cv.pow(mRF, invGamma, mRF);
        cv.pow(mGF, invGamma, mGF);
        cv.pow(mBF, invGamma, mBF);

        // Convert to 8-bit
        mRF.convertTo(mR, cv.CV_8U, 255);
        mGF.convertTo(mG, cv.CV_8U, 255);
        mBF.convertTo(mB, cv.CV_8U, 255);
        mInvAF.convertTo(this._cA, cv.CV_8U, 255);

        // Combine channels
        const channels = new cv.MatVector();
        channels.push_back(mR);
        channels.push_back(mG);
        channels.push_back(mB);
        channels.push_back(this._cA);
        cv.merge(channels, this._cRGBA);
        channels.deleteLater();

        // Release memory
        mR.deleteLater();
        mG.deleteLater();
        mB.deleteLater();
        mRF.deleteLater();
        mGF.deleteLater();
        mBF.deleteLater();
        mInvAF.deleteLater();
        mTmp.deleteLater();

        return this._cRGBA;
    }

    getAlphaChannel(design) {
        const { width, height } = design;

        this._cA.deleteLater();
        this._cA = crop(this._A, width, height);

        if (this.plotsArr.length == 1) {
            this.plotsArr[0].getImage(design).convertTo(this._cA, cv.CV_8U, -1, 255);
        } else {
            const mInvAF = crop(this._AF, width, height);
            mInvAF.setTo([1, 1, 1, 1]); // Opaque

            for (let i = 0; i < this.plotsArr.length; i++) {
                const imageF = this.plotsArr[i].getImageF(design);
                // Inverted alpha
                cv.multiply(mInvAF, imageF, mInvAF);
            }

            mInvAF.convertTo(this._cA, cv.CV_8U, -255, 255);
            mInvAF.deleteLater();
        }

        return this._cA;
    }

    getAlphaChannelWithout(design, label) {
        const { width, height } = design;

        this._cAwo.deleteLater();
        this._cAwo = crop(this._Awo, width, height);

        const mInvAFwo = crop(this._tmpF, width, height);
        mInvAFwo.setTo([1, 1, 1, 1]); // Opaque

        this.plots.forEach( (plot, l) => {
            if (l !== label) {
                const imageF = plot.getImageF(design);
                // Inverted alpha
                cv.multiply(mInvAFwo, imageF, mInvAFwo);
            }
        });

        mInvAFwo.convertTo(this._cAwo, cv.CV_8U, -255, 255);
        mInvAFwo.deleteLater();

        return this._cAwo;
    }

    getImages(design) {
        return [...this.plots.values()].map(p => p.getImage(design));
    }

    getImagesF(design) {
        return [...this.plots.values()].map(p => p.getImageF(design));
    }
}