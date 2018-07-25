/// <reference types="node" />
import { IpcSocket } from './socket';
import { Config as ProtocolConfig } from './protocol';
interface ServerConfig {
    allowHalfOpen?: boolean;
    pauseOnConnect?: boolean;
    messageHandler: MessageHandler;
    errorHandler: ErrorHandler;
}
export declare type MessageHandler = (client: IpcSocket, data: Buffer, response: (reply?: Buffer | Promise<Buffer>) => Promise<void>) => void;
export declare type ErrorHandler = (client: IpcSocket | undefined, error: Error) => void;
export declare type IpcSocketServerConstructorOptions = ProtocolConfig & ServerConfig;
export declare class IpcSocketServer {
    private _protocolConfig;
    private _clients;
    private _server;
    private _messageHandler;
    private _errorHandler;
    constructor(options: IpcSocketServerConstructorOptions);
    listen(path: string, timeoutMs?: number): Promise<void>;
    private _onClose;
    private _onConnection;
    private _onMessage;
    private _onError;
    private _Client_onError;
}
export {};
