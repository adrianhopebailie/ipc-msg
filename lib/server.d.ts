import { IProtocolConfig } from './protocol';
import { ErrorHandler, MessageHandler } from './socket';
export interface IServerConfig {
    id: string;
    messageHandler: MessageHandler;
    errorHandler: ErrorHandler;
    allowHalfOpen?: boolean;
    pauseOnConnect?: boolean;
}
export declare class IpcSocketServer {
    private _id;
    private _protocolConfig;
    private _clients;
    private _server;
    private _messageHandler;
    private _errorHandler;
    private _log;
    constructor(config: IServerConfig, protocolConfig: IProtocolConfig);
    readonly id: string;
    listen(path: string, timeoutMs?: number): Promise<void>;
    private _onClose;
    private _onConnection;
    private _onError;
    private _Client_onMessage;
    private _Client_onError;
}
