import React from "react"
import * as Papa from "papaparse";
import config from "./config";

/*
* User steps:
* 1: select file
* 2: confirm format
* 3: load
* 4: choose variables
* 5: optimize
* */

export default class DataImport extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            // Source options
            csvFile: undefined,
            csvURL: "",
            useFile: false,
            useExample: true,
            // Parsing State
            parsingInProgress: false,
            // Parsing options
            skipHeader: true,
            delimiter: "",
            encoding: "",
            commentStr: "",
            // Parsed data
            preview: [],
            data: [],
            columnIds: [],
            columnX: "",
            columnY: "",
            columnClass: "",
            columnOutlier: "",
            classLabels: [],
        };

        this.exampleDataSets = config.exampleDataSets.map(([name, path]) => {
            const url = new URL(path, window.location);
            return [name, url.toString()];
        });
    }
    useExample = (e) => this.setState({ useExample: true, useFile: false });
    useFile = (e) => this.setState({ useFile: true, useExample: false });
    useURL = (e) => this.setState({ useFile: false, useExample: false });
    setURL = (e) => this.setState({ csvURL: e.target.value });
    selectFile = (e) => this.setState({ csvFile: e.target.files[0] });

    setSkipHeader = (e) => this.setState({ skipHeader: e.target.checked });
    setDelimiter = (e) => this.setState({ delimiter: e.target.value });
    setEncoding = (e) => this.setState({ encoding: e.target.value });
    setCommentStr = (e) => this.setState({ commentStr: e.target.value });

    setColumnX = (e) => this.setState({ columnX: e.target.value });
    setColumnY = (e) => this.setState({ columnY: e.target.value });
    setColumnClass = (e) => this.setState({ columnClass: e.target.value });
    setColumnOutlier = (e) => this.setState({ columnOutlier: e.target.value });

    updateClassLabels = () => {
        const c = this.state.columnIds.indexOf(this.state.columnClass);
        if (c < 0) {
            return;
        }
        const data = this.state.data;
        let classLabels = new Set();
        const maxClasses = 20;
        for (let r = 0; r < data.length; r++) {
            classLabels.add(data[r][c]);

            if (classLabels.size > maxClasses) {
                this.setState({ columnClass: "" });
                window.alert(`We only support ${maxClasses} classes. Too many unique values found in ${this.state.columnClass}.`);
                return;
            }
        }
        classLabels = [...classLabels]; // Set to Array
    };

    resetDataOptions = () => {
        this.setState({
            data: [],
            columnIds: [],
            columnX: "",
            columnY: "",
            columnClass: "",
            classLabels: [],
        });
    };

    parsePreview = () => {
        const source = this.state.useFile ? this.state.csvFile : this.state.csvURL;
        if (!source) {
            return;
        }
        this.setState({ preview: [] });
        this.resetDataOptions();

        Papa.parse(source, {
            ...config.csvParser.userInput,
            download: !this.state.useFile,
            header: false,  // Assume no header when parsing the preview, but later check if the first row looks like a header
            preview: 5, // Read only the first 5 lines
            complete: (result) => {
                if (!result.data.length) {
                    return;
                }
                if (result.errors.length) {
                    console.error("Parsing preview failed", result.errors);
                }

                const firstRow = result.data[0];
                // If all fields in the first row are non-numeric, it must be a header
                const looksLikeHeader = firstRow.every(v => isNaN(v));

                this.setState({ preview: result.data, skipHeader: looksLikeHeader });
            }
        });
    };

    parseData = () => {
        const source = this.state.useFile ? this.state.csvFile : this.state.csvURL;
        if (!source) {
            return;
        }
        this.resetDataOptions();
        this.setState({ parsingInProgress: true });
        Papa.parse(source, {
            ...config.csvParser.userInput,
            delimiter: this.state.delimiter,
            encoding: this.state.encoding,
            comments: this.state.commentStr,
            download: !this.state.useFile,
            worker: true,
            header: false,  // This will cause resulting data to be an array rather than an object
            complete: (result) => {
                if (!result.data.length) {
                    return;
                }
                if (result.errors.length) {
                    console.error("Parsing data failed", result.errors);
                }

                const data = result.data;
                const columnIds = this.state.skipHeader ? data.shift() : [...data[0].keys()].map(i => `Column ${i}`);
                const columnX = columnIds[0] || "";
                const columnY = columnIds[1] || "";
                const columnClass = this.state.useExample ? (columnIds[2] || this.state.columnClass) : this.state.columnClass;
                const columnOutlier = this.state.useExample ? (columnIds[3] || this.state.columnOutlier) : this.state.columnOutlier;

                this.setState({ data, columnIds, columnX, columnY, columnClass, columnOutlier, parsingInProgress: false });
            }
        });
    };

    exportData = () => {
        const { data, columnIds, columnX, columnY, columnClass, columnOutlier } = this.state;
        const cX = columnIds.indexOf(columnX);
        const cY = columnIds.indexOf(columnY);
        const cClass = columnIds.indexOf(columnClass);
        const cOutlier = columnIds.indexOf(columnOutlier);
        if (cX < 0 || cY < 0) {
            return;
        }

        const points = [];
        let row;

        const classLabels = new Map();

        for (let r = 0; r < data.length; r++) {
            row = data[r];
            const isOutlier = cOutlier > -1 && !!row[cOutlier];
            let classLabel;
            if (isOutlier) {
                classLabel = -1;
            } else {
                const classVal = row[cClass];
                classLabel = classLabels.has(classVal) ? classLabels.get(classVal) : classLabels.size;
                classLabels.set(classVal, classLabel);
            }
            points.push([
                row[cX],
                row[cY],
                classLabel
            ]);
        }
        const numberOfClasses = classLabels.size || 1;
        normalize(points);
        this.props.onExport({ points, numberOfClasses });
    };

    componentDidUpdate(prevProps, prevState) {
        const currState = this.state;
        if (currState.useFile && currState.csvFile !== prevState.csvFile) {
            this.parsePreview();
        }
        if (currState.columnClass !== prevState.columnClass) {
            this.updateClassLabels()
        }
        if (currState.useExample) {
            if (currState.csvURL !== prevState.csvURL) {
                this.parseData();
            }
            if (currState.data !== prevState.data) {
                this.exportData();
            }
        }
    }

    componentDidMount() {
        this.setState({ csvURL: this.exampleDataSets[0][1] });
    }

    render() {
        const { useFile, useExample, parsingInProgress } = this.state;
        return <form className="data-import">
            <fieldset>
                <legend>1. Data Source</legend>
                <label>
                    <span>
                        <input type="radio" name="source" value="url" checked={useExample} onChange={this.useExample} />
                        <span className="label">Example Data Set</span>
                    </span>
                </label>
                <label>
                    <span>
                        <input type="radio" name="source" value="file" checked={useFile} onChange={this.useFile} />
                        <span className="label">Local CSV file</span>
                    </span>
                </label>
                <label>
                    <span>
                        <input type="radio" name="source" value="url" checked={!useFile && !useExample} onChange={this.useURL} />
                        <span className="label">Remote CSV file</span>
                    </span>
                </label>
            </fieldset>
            <fieldset disabled={!useExample}>
                <legend>2. Example Data Set</legend>
                <label>
                    <select name="sourceURL" onChange={this.setURL} value={this.state.csvURL}>
                        {this.exampleDataSets.map(([name, url]) => (
                            <option key={url} value={url}>{name}</option>
                        ))}
                    </select>
                    <em className={"loading " + (parsingInProgress ? "show" : "hide")}>Downloading and parsing</em>
                </label>
            </fieldset>
            <fieldset disabled={!useFile}>
                <legend>2. Local CSV File</legend>
                <label className="stack">
                    <input type="file" name="sourceFile" onChange={this.selectFile} />
                    <span className="value">{!!this.state.csvFile ? this.state.csvFile.name : ""}</span>
                </label>
            </fieldset>
            <fieldset disabled={useFile || useExample}>
                <legend>2. Remote CSV File</legend>
                <label>
                    <span className="label">URL</span>
                    <input type="text" name="sourceURL" size="10" onChange={this.setURL} />
                </label>
                <button type="button" disabled={!this.state.csvURL} onClick={this.parsePreview}>Download</button>
            </fieldset>
            <fieldset disabled={!this.state.preview.length || useExample}>
                <legend>3. Preview Data</legend>
                <label><input type="checkbox" name="skipHeader" checked={this.state.skipHeader}
                              onChange={this.setSkipHeader} /> Skip the first (header) row</label>
                <label>
                    <span className="label">Delimiter</span>
                    <input type="text" size="4" name="delimiter" maxLength="1" placeholder="auto"
                           value={this.state.delimiter} onChange={this.setDelimiter} />
                    <button type="button" onClick={this.setDelimiter} value="\t">Tab</button>
                </label>
                <label>
                    <span className="label">File encoding</span>
                    <input type="text" size="7" placeholder="default" id="parseEncoding" name="parseEncoding"
                           value={this.state.encoding} onChange={this.setEncoding} />
                </label>
                <label title="If specified, skips lines starting with this string.">
                    <span className="label">Comment string:</span>
                    <input type="text" size="7" maxLength="10" name="commentStr"
                           value={this.state.commentStr} onChange={this.setCommentStr} />
                </label>
                <PreviewTable data={this.state.preview} />
                <button type="button" disabled={!this.state.preview.length} onClick={this.parseData}>Load</button>
            </fieldset>
            <fieldset disabled={!this.state.data.length || useExample}>
                <legend>4. Select Variables</legend>
                <label>
                    <span className="label">X column</span>
                    <select name="colX" value={this.state.columnX} onChange={this.setColumnX}>
                        {["", ...this.state.columnIds].map(colId => <option key={colId} value={colId}>{colId}</option>)}
                    </select>
                </label>
                <label>
                    <span className="label">Y column</span>
                    <select name="colY" value={this.state.columnY} onChange={this.setColumnY}>
                        {["", ...this.state.columnIds].map(colId => <option key={colId} value={colId}>{colId}</option>)}
                    </select>
                </label>
                <label>
                    <span className="label">Class column</span>
                    <select name="colLabel" value={this.state.columnClass} onChange={this.setColumnClass}>
                        {["", ...this.state.columnIds].map(colId => <option key={colId} value={colId}>{colId}</option>)}
                    </select>
                </label>
                <label>
                    <span className="label">Outlier column</span>
                    <select name="colOutlier" value={this.state.columnOutlier} onChange={this.setColumnOutlier}>
                        {["", ...this.state.columnIds].map(colId => <option key={colId} value={colId}>{colId}</option>)}
                    </select>
                </label>
                <button type="button" onClick={this.exportData}>Show</button>
            </fieldset>
        </form>
    }
}

class PreviewTable extends React.Component {
    render() {
        const { data = [] } = this.props;
        return (
            <table><tbody>
                {data.map((row, r) => (
                    <tr key={r}>{row.map((col, c) => (
                        <td key={c}>{col}</td>
                    ))}</tr>
                ))}
            </tbody></table>
        );
    }
}


function normalize(points) {
    // Normalize to [-.5, .5]
    if (!points.length || !points[0].length) {
        return;
    }
    let [xMin, yMin] = points[0];
    let [xMax, yMax] = [xMin, yMin];
    let pX, pY;
    // Compute bounds
    for (let p = 0; p < points.length; p++) {
        [pX, pY] = points[p];
        if (pX < xMin) { xMin = pX }
        else if (pX > xMax) { xMax = pX }
        if (pY < yMin) { yMin = pY }
        else if (pY > yMax) { yMax = pY }
    }
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;
    // Normalize
    let point;
    for (let p = 0; p < points.length; p++) {
        point = points[p];
        point[0] = ((point[0] - xMin) / xRange) - .5;
        point[1] = ((point[1] - yMin) / yRange) - .5;
    }
}