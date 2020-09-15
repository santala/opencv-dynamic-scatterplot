import 'regenerator-runtime/runtime'; // async/await support

import React from "react"
import * as d3 from "d3-color";

import config from "./config"
import ScatterplotOptimizer from "./optimizer";

const getNEquidistantRGBColorMap = (() => {
    const l = 50;
    const c = 100;
    const cache = new Map();
    return (n) => {
        if (!cache.has(n)) {
            const colors = [];
            const h_dist = 360 / n;
            for (let i = 0; i < n; i++) {
                const rgbObj = d3.rgb(d3.lch(l, c, i * h_dist));
                // Convert RGB to array, scale and clamp to [0, 1]
                colors.push([rgbObj.r, rgbObj.b, rgbObj.b].map(v => Math.max(0, Math.min(1, v / 255))));
            }
            cache.set(n, colors);
        }
        return cache.get(n);
    };
})();

function getClassCount(data) {
    // -1 denotes the outlier class
    // If there is only one class and outliers, the outliers are considered to be the same class
    return data.has(-1) && data.size == 2 ? 1 : data.size;
}

function aspectDiffToRatio(aspectDiff) {
    let aspectRatio;
    if (aspectDiff < 0) {
        aspectRatio = 1 / (1 - aspectDiff);
    } else {
        aspectRatio = 1 + aspectDiff;
    }
    return aspectRatio;
}

function aspectRatioToDiff(aspectRatio) {
    let aspectDiff;
    if (aspectRatio < 1) {
        aspectDiff = 1 - (1 / aspectRatio)
    } else {
        aspectDiff = aspectRatio - 1;
    }
    return aspectDiff;
}

function rangeToArray({ min = 0, max = 1, step = 1 }) {
    const array = [];
    for (let val = min; val <= max; val += step) {
        array.push(val);
    }
    return array;
}

function controlsToDesign ({ markerOpacity, aspectDiff, markerSize, maxWidth, maxHeight, colors }) {
    const aspectRatio = aspectDiffToRatio(aspectDiff);

    let height = maxHeight;
    let width = Math.round(aspectRatio * height);

    if (width > maxWidth) {
        width = maxWidth;
        height = Math.round(width / aspectRatio);
    }

    return {
        width, height, markerOpacity, markerSize, colors,
        markerType: "circle"
    };
}

export class ManualScatterplot extends React.Component {
    constructor(props) {
        super(props);

        this.canvas = React.createRef();
        this.optimizer = null;

        this.state = {
            aspectDiff: 0,
            design: {
                width: 100,
                height: 100,
                markerOpacity: config.designSpaceAlt.markerOpacity.max,
                markerSize: config.designSpaceAlt.markerSize.min + config.designSpaceAlt.markerSize.step,
                markerType: "circle",
                colors: getNEquidistantRGBColorMap(1)
            },
            selectedWeightPreset: "",
            weights: Array(10).fill(0),
            designSpaceSize: 0,
            designsOptimized: 0,
            evaluateWhileEditing: false,
            score: 0,
        };
    }

    updateDesign = (design) => {
        this.setState({ design: { ...this.state.design, ...design }});
    };

    updateAspectDiff = (aspectDiff) => {
        const { width: maxWidth, height: maxHeight } = this.getAvailableSpace();
        const aspectRatio = aspectDiffToRatio(aspectDiff);

        let height = maxHeight;
        let width = Math.round(aspectRatio * height);

        if (width > maxWidth) {
            width = maxWidth;
            height = Math.round(width / aspectRatio);
        }

        this.setState({ aspectDiff });
        this.updateDesign({ width, height });
    };

    getAvailableSpace = () => {
        const canvas = this.canvas.current;
        return {
            width: !!canvas ? canvas.parentElement.clientWidth : 0,
            height: !!canvas ? canvas.parentElement.clientHeight : 0
        };
    };

    optimizeDesign = () => {
        const { data } = this.props;
        const { weights } = this.state;
        let { designsOptimized, designSpaceSize } = this.state;
        if (designsOptimized !== designSpaceSize) {
            // Optimization in progress
            return;
        }

        const colors = getNEquidistantRGBColorMap(getClassCount(data));

        const { width: maxWidth, height: maxHeight } = this.getAvailableSpace();

        console.time("Optimize");

        const batches = [];

        const aspectDiffs = rangeToArray({ ...config.designSpaceAlt.aspectDiff, step: .2 });
        const markerSizes = rangeToArray({ ...config.designSpaceAlt.markerSize, step: 2 });
        const markerOpacities = rangeToArray({ ...config.designSpaceAlt.markerOpacity, min: 15, step: 15 });

        for (let aspectDiff of aspectDiffs) {
            for (let markerSize of markerSizes) {
                const designs = [];
                for (let markerOpacity of markerOpacities) {
                    designs.push(controlsToDesign({ aspectDiff, markerSize, markerOpacity, colors, maxWidth, maxHeight }));
                }
                batches.push(designs);
            }
        }

        const batchSize = batches[0].length;
        designSpaceSize = batches.length * batchSize;
        designsOptimized = 0;
        this.setState({ designSpaceSize, designsOptimized });
        designsOptimized = batches[0].length;
        this.setState({ designsOptimized });

        console.log(`${batchSize * batches.length} designs`);

        batches.forEach(batch => {
            setImmediate(() => {
                const { designSpaceSize, designsOptimized } = this.state;
                for (let i = 0; i < batch.length; i++) {
                    this.optimizer.evaluate(batch[i]);
                }
                if (designsOptimized === designSpaceSize) { // Optimization done
                    const { design, score } = this.optimizer.findBest(weights);
                    console.timeEnd("Optimize");
                    console.log(score, design);
                    this.setState({ design, score });

                }
                this.setState({ designsOptimized: Math.min(designsOptimized + batchSize, designSpaceSize) });

            });
        });

    };

    updateWeight = (i, val) => {
        const weights = [...this.state.weights];
        weights[i] = parseFloat(val);
        this.setState({ weights });
    };

    componentDidMount() {
        this.updateAspectDiff(this.state.aspectDiff);
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        const { renderer, data } = this.props;
        const { design, selectedWeightPreset, weights } = this.state;
        const canvas = this.canvas.current;
        if (!!data && data !== prevProps.data) {
            this.updateDesign({ colors: getNEquidistantRGBColorMap(getClassCount(data))})
        }
        if (!!renderer && !!data && !!design && !!canvas) {
            if (renderer !== prevProps.renderer || data !== prevProps.data || design !== prevState.design) {
                cv.imshow(canvas, renderer.getImage(design));
            }
        }
        if (!!renderer && renderer !== prevProps.renderer && !this.optimizer) {
            this.optimizer = new ScatterplotOptimizer(renderer);
        }
        if (!!this.optimizer && !!data && data !== prevProps.data) {
            this.optimizer.reset();
        }
        if (!!selectedWeightPreset && selectedWeightPreset !== prevState.selectedWeightPreset) {
            this.setState({ weights: config.weightPresets[selectedWeightPreset] });
        }
        if (weights.some((w, i) => w !== prevState.weights[i])) {
            const presetIdx = Object.values(config.weightPresets).findIndex(preset =>
                weights.every((w, i) => w === preset[i])
            );
            const presetKey = presetIdx >= 0 ? Object.keys(config.weightPresets)[presetIdx] : "";
            this.setState({ selectedWeightPreset: presetKey});
            this.optimizeDesign();
        }
    }

    render() {
        const { design, selectedWeightPreset, weights, evaluateWhileEditing, designSpaceSize, designsOptimized } = this.state;
        const { width, height, markerOpacity, markerSize } = design;

        let measures = [];
        let score = 0;

        if (!!this.optimizer && evaluateWhileEditing) {
            const result = this.optimizer.evaluate(design, weights);
            measures = result.measures;
            score = result.score;
        }

        const canvasWidth = width * (window.devicePixelRatio || 1) * 2;
        const canvasHeight = height * (window.devicePixelRatio || 1) * 2;

        return <div className="scatterplot">
            <OverlayMenu title="Manual Adjustment">
                <Range name="aspectRatio" label="Aspect ratio"
                       min={config.designSpaceAlt.aspectDiff.min}
                       max={config.designSpaceAlt.aspectDiff.max}
                       step={config.designSpaceAlt.aspectDiff.step}
                       value={aspectRatioToDiff(width / height)}
                       displayValue={Math.round(width / height * 100) / 100}
                       onChange={e => this.updateAspectDiff(parseFloat(e.target.value))} />
                <Range name="markerSize" label="Marker size"
                       min={config.designSpaceAlt.markerSize.min}
                       max={config.designSpaceAlt.markerSize.max}
                       step={config.designSpaceAlt.markerSize.step}
                       value={markerSize}  onChange={e => this.updateDesign({ markerSize: parseInt(e.target.value)})} />
                <Range name="markerOpacity" label="Marker opacity"
                       min={config.designSpaceAlt.markerOpacity.min}
                       max={config.designSpaceAlt.markerOpacity.max}
                       step={config.designSpaceAlt.markerOpacity.step}
                       value={markerOpacity}  onChange={e => this.updateDesign({ markerOpacity: parseInt(e.target.value) })} />
            </OverlayMenu>
            <OverlayMenu open={false} title={<>
                <label>
                    Optimize for&nbsp;
                    <select value={selectedWeightPreset} onChange={e => this.setState({ selectedWeightPreset: e.target.value })}>
                        <option key={""} value={""}></option>
                        {Object.keys(config.weightPresets).map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    &nbsp;<button onClick={this.optimizeDesign} className="reload"></button>
                </label>
                <br/>
                <progress value={designsOptimized} max={designSpaceSize}></progress>
            </>}>
                <label>
                    <input type="checkbox" checked={evaluateWhileEditing}
                           onChange={e => this.setState({ evaluateWhileEditing: e.target.checked })}/>
                    &nbsp;Evaluate while editing
                    <span>{evaluateWhileEditing ? Math.round(score * 100) / 100 : "–"}</span>
                </label>
                {Object.values(config.metrics).map((label, i) => (
                    <Range key={i} name={label} label={label} min="-1" max="1" step="0.01" value={weights[i]}
                           onChange={e => this.updateWeight(i, e.target.value)}
                           displayValue={<>{Math.round(weights[i]*100)}&nbsp;|&nbsp;{!!measures.length ? Math.round(measures[i]*100) : "–"}%</>} />
                ))}
            </OverlayMenu>
            <canvas ref={this.canvas} className="scatterplot-canvas" width={canvasWidth} height={canvasHeight}
                    style={{ width: `${width}px`, height: `${height}px` }} />
        </div>
    }
}

class OverlayMenu extends React.Component {
    render() {
        const { title, children, open = true } = this.props;
        return <details className="overlay" tabIndex="0" open={open}>
            <summary>{title}</summary>
            <div className="controls">
                {children}
            </div>
        </details>
    }
}

class Range extends React.Component {
    render() {
        const { label, name, min, max, step, value, displayValue, onChange } = this.props;
        return <label>
            <span className="label">{label}</span>
            <input name={name} type="range" min={min} max={max} step={step}
                   value={value} onChange={onChange} />
           <span className="value">{displayValue || value}</span>
        </label>
    }
}