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
const log_1 = require("./log");
const protocol_1 = require("./protocol");
const socket_1 = require("./socket");
class IpcSocketServer {
    constructor(config, protocolConfig) {
        this._clients = new Map();
        this._server = new net_1.Server({
            allowHalfOpen: config.allowHalfOpen,
            pauseOnConnect: config.pauseOnConnect,
        });
        this._id = config.id;
        this._messageHandler = config.messageHandler;
        this._errorHandler = config.errorHandler;
        this._protocolConfig = protocolConfig;
        this._server.on('close', this._onClose.bind(this));
        this._server.on('connection', this._onConnection.bind(this));
        this._server.on('error', this._onError.bind(this));
        this._log = log_1.create('ipc-server:' + config.id);
    }
    get id() {
        return this._id;
    }
    listen(path, timeoutMs) {
        return __awaiter(this, void 0, void 0, function* () {
            this._log.debug(`Starting server...`);
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(reject, timeoutMs || 30000);
                this._server.listen(path, () => {
                    this._log.info(`Server listening at ${path}`);
                    clearTimeout(timeout);
                    resolve();
                });
            });
        });
    }
    _onClose() {
        this._log.info('Server closed');
    }
    _onConnection(socket) {
        const id = new protocol_1.UUID();
        const client = new socket_1.IpcSocket({
            id: id.toString(),
            socketOrPath: socket,
        }, this._protocolConfig);
        this._clients.set(id.toString(), client);
        client.messageHandler = this._Client_onMessage.bind(this);
        client.errorHandler = this._Client_onError.bind(this);
    }
    _onError(error) {
        this._log.error(`Error on server:`, error);
        return this._errorHandler(this, error);
    }
    _Client_onMessage(client, data, response) {
        this._log.trace(`Message from client: ${client.id}`, data);
        return this._messageHandler(client, data, response);
    }
    _Client_onError(client, error) {
        this._log.error(`Error on client: ${client.id}`, error);
        return this._errorHandler(client, error);
    }
}
exports.IpcSocketServer = IpcSocketServer;
//# sourceMappingURL=server.js.map