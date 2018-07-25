"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = require("net");
const socket_1 = require("./socket");
const protocol_1 = require("./protocol");
const log_1 = require("./log");
const log = log_1.create('ipc-server');
class IpcSocketServer {
    constructor(options) {
        this._clients = new Map();
        this._server = new net_1.Server({
            allowHalfOpen: options.allowHalfOpen,
            pauseOnConnect: options.pauseOnConnect
        });
        this._messageHandler = options.messageHandler;
        this._errorHandler = options.errorHandler;
        this._protocolConfig = options;
        this._server.on('close', this._onClose.bind(this));
        this._server.on('connection', this._onConnection.bind(this));
        this._server.on('error', this._onError.bind(this));
    }
    listen(path, timeoutMs) {
        return __awaiter(this, void 0, void 0, function* () {
            log.debug(`Starting server...`);
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(reject, timeoutMs || 30000);
                this._server.listen(path, () => {
                    log.info(`Server listening at ${path}`);
                    clearTimeout(timeout);
                    resolve();
                });
            });
        });
    }
    _onClose() {
    }
    _onConnection(socket) {
        const id = new protocol_1.UUID();
        const client = new socket_1.IpcSocket({
            id: id.toString(),
            socketOrPath: socket,
        }, this._protocolConfig);
        this._clients.set(id, client);
        client.messageHandler = (data, response) => {
            return this._onMessage(client, data, response);
        };
        client.errorHandler = (error) => {
            return this._Client_onError(client, error);
        };
    }
    _onMessage(client, data, response) {
        log.trace(`Message from client: ${client.id}`, data);
        return this._messageHandler(client, data, response);
    }
    _onError(error) {
        log.error(`Error on server:`, error);
        return this._errorHandler(undefined, error);
    }
    _Client_onError(client, error) {
        log.error(`Error on client: ${client.id}`, error);
        return this._errorHandler(client, error);
    }
}
exports.IpcSocketServer = IpcSocketServer;
//# sourceMappingURL=server.js.map