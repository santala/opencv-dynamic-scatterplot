import "@fortawesome/fontawesome-free/css/all.css";
import "./style.scss";

import React from "react";
import ReactDOM from "react-dom";

import DataImport from "./data-import"
import {ManualScatterplot} from "./scatterplots";
import {MultiClassPlot} from "./renderer";
import config from "./config";

const functionsToCallAfterOpenCVInit = (() => {
    const functionsArr = []; // Array to hold the functions
    const that = {};
    that.add = (f) => functionsArr.push(f);
    that.init = () => {
        // Replace add with instantaneous call
        that.add = (f) => {f()};
        functionsArr.forEach(f => f());
    };
    return that;
})();

cv['onRuntimeInitialized'] = () => {
    console.log("OpenCV initialized");
    functionsToCallAfterOpenCVInit.init();
};

class App extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            renderer: null,
            points: null,
            data: new Map(),
            limits: {}
        };

        functionsToCallAfterOpenCVInit.add(this.initRenderer);
    }

    initRenderer = () => {
        this.setState({
            renderer: new MultiClassPlot({
                maxWidth: 2000,
                maxHeight: 2000,
                markers: { circle: new Circle() },
                maxMarkerSize: config.designSpaceAlt.markerSize.max
            })
        });
    };

    updateData = () => {
        const { renderer, points } = this.state;
        const data = new Map();
        let xMin = Number.MAX_VALUE,
            yMin = Number.MAX_VALUE,
            xMax = Number.MIN_VALUE,
            yMax = Number.MIN_VALUE;
        for (let i = 0; i < points.length; i++) {
            const [x, y, label] = points[i];
            if (!data.has(label)) {
                data.set(label, {x: [], y: []})
            }
            const group = data.get(label);
            group.x.push(x);
            group.y.push(y);
            xMin = Math.min(xMin, x);
            yMin = Math.min(yMin, y);
            xMax = Math.max(xMax, x);
            yMax = Math.max(yMax, y);
        }

        renderer.setData({ data, xMin, yMin, xMax, yMax });
        this.setState({ data, limits: { xMin, yMin, xMax, yMax } });
    };

    componentDidUpdate(prevProps, prevState, snapshot) {
        const { renderer, points } = this.state;
        if (!!renderer && !!points && (renderer !== prevState.renderer || points !== prevState.points)) {
            this.updateData();
        }
    }

    render() {
        const { renderer, data } = this.state;
        return <div id="main">
            <DataImport onExport={({ points }) => this.setState( { points })}/>
            <ManualScatterplot renderer={renderer} data={data} />
        </div>
    }
}

ReactDOM.render(<App />, document.getElementById("app"));

class Marker {
    constructor() {
        this._cache = {};
    }

    getMat(size) {
        let mat = this._cache[size];
        if (!mat) {
            mat = this.generateMat(size);
            this._cache[size] = mat;
        }
        return mat;
    }

    generateMat(size) {
        throw "Abstract method generateMat not implemented";
    }

    getDimensions(size) {
        throw "Abstract method getDimensions not implemented";
    }
}

class Circle extends Marker { // TODO: consider making these singletons

    getDimensions(size) {
        return { width: size, height: size };
    }

    generateMat(size) {
        const radius = size / 2;
        const markerCanvas = document.createElement("canvas");
        markerCanvas.width = size;
        markerCanvas.height = size;

        const ctx = markerCanvas.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "white";
        ctx.arc(radius, radius, radius, 0, 2 * Math.PI);
        ctx.fill();

        const marker = cv.imread(markerCanvas);
        const channels = new cv.MatVector();
        cv.split(marker, channels);
        const mat = channels.get(0);
        marker.delete();
        channels.delete();

        return mat;
    }
}

class TriangleUp extends Marker { // TODO: consider making these singletons

    getDimensions(size) {
        return { width: size, height: size };
    }

    generateMat(size) {

        const markerCanvas = document.createElement("canvas");
        markerCanvas.width = size;
        markerCanvas.height = size;

        const ctx = markerCanvas.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.moveTo(0, size);
        ctx.lineTo(size, size);
        ctx.lineTo(size/2, 0);
        ctx.closePath();
        ctx.fill();

        const marker = cv.imread(markerCanvas);
        const channels = new cv.MatVector();
        cv.split(marker, channels);
        const mat = channels.get(0);
        marker.delete();
        channels.delete();

        return mat;
    }
}

class Square extends Marker { // TODO: consider making these singletons

    getDimensions(size) {
        return { width: size, height: size };
    }

    generateMat(size) {
        return new cv.Mat(size, size, cv.CV_8UC1, [255, 255, 255, 255]);
    }
}