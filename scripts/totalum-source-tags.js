const path = require("path");

const NOT_DOM = new Set(["Fragment", "React.Fragment", "Suspense", "StrictMode", "Profiler", "ErrorBoundary"]);

function isTaggable(name) {
    if (!name) return false;
    if (NOT_DOM.has(name)) return false;
    if (/Provider$/.test(name) || /Context$/.test(name)) return false;
    return true;
}

module.exports = function totalumSourceTags(source) {
    if (process.env.TOTALUM_SOURCE_TAGS === "0") return source;

    let ts;
    try {
        ts = require("typescript");
    } catch (error) {
        return source;
    }

    const resourcePath = this.resourcePath || "";
    if (resourcePath.includes("node_modules")) return source;
    if (!/\.(tsx|jsx)$/.test(resourcePath)) return source;
    if (source.indexOf("<") === -1) return source;

    const relative = path
        .relative(this.rootContext || process.cwd(), resourcePath)
        .split(path.sep)
        .join("/");

    let sourceFile;
    try {
        sourceFile = ts.createSourceFile(resourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    } catch (error) {
        return source;
    }

    const insertions = [];

    const visit = node => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const name = node.tagName.getText(sourceFile);
            const alreadyTagged = node.attributes.properties.some(
                property =>
                    ts.isJsxAttribute(property) &&
                    property.name &&
                    property.name.getText(sourceFile) === "data-tlm-loc"
            );
            if (isTaggable(name) && !alreadyTagged) {
                const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
                insertions.push({
                    at: node.tagName.end,
                    text: ' data-tlm-loc="' + relative + ':' + (position.line + 1) + ':' + (position.character + 1) + '"',
                });
            }
        }
        ts.forEachChild(node, visit);
    };

    try {
        visit(sourceFile);
    } catch (error) {
        return source;
    }

    if (insertions.length === 0) return source;

    insertions.sort((a, b) => b.at - a.at);
    let output = source;
    for (const insertion of insertions) {
        output = output.slice(0, insertion.at) + insertion.text + output.slice(insertion.at);
    }
    return output;
};
