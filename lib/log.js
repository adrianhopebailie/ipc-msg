"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const riverpig = require("riverpig/dist/src");
const debug = require("debug");
const through2 = require("through2");
let outputStream = process.stdout;
const logStream = through2();
logStream.pipe(outputStream);
class Logger {
    constructor(namespace, config0) {
        this.river = riverpig(namespace, config0);
        this.tracer = this.river.trace || debug(namespace + ':trace');
    }
    info(...msg) {
        this.river.info(msg);
    }
    warn(...msg) {
        this.river.warn(msg);
    }
    error(...msg) {
        this.river.error(msg);
    }
    debug(...msg) {
        this.river.debug(msg);
    }
    trace(...msg) {
        this.tracer(msg);
    }
}
exports.Logger = Logger;
exports.createRaw = (namespace) => {
    return new Logger(namespace, {
        stream: logStream
    });
};
exports.create = (namespace) => exports.createRaw('ipc-rpc:' + namespace);
exports.setOutputStream = (newOutputStream) => {
    logStream.unpipe(outputStream);
    logStream.pipe(newOutputStream);
    outputStream = newOutputStream;
};
//# sourceMappingURL=log.js.map