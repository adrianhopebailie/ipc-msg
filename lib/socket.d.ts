/// <reference types="node" />
import { Config as ProtocolConfig } from './protocol';
import { Socket } from 'net';
export declare type MessageHandler = (data: Buffer, respond: (reply?: Promise<Buffer> | Buffer) => Promise<void>) => void;
export declare type ErrorHandler = (error: Error) => void;
export interface SocketConfig {
    id: string;
    socketOrPath: Socket | string;
    messageHandler?: MessageHandler;
    errorHandler?: ErrorHandler;
}
export declare class IpcSocket {
    private _id;
    private _config;
    private _socket;
    private _sentMessages;
    private _sentRequests;
    private _sentReplies;
    private _receivedMessages;
    private _reader;
    private _writer;
    private _messageHandler?;
    private _errorHandler?;
    constructor(options: SocketConfig, protocolOptions: ProtocolConfig);
    readonly id: string;
    messageHandler: MessageHandler;
    errorHandler: ErrorHandler;
    sendMessage(data: Buffer): Promise<void>;
    sendRequest(data: Buffer, ack: () => void): Promise<Buffer>;
    private _createAndSendReply;
    private _retry;
    private _sendReply;
    private _sendAck;
    private _sendNak;
    private _resendResponse;
    private _callMessageHandler;
    private _callErrorHandler;
    private _Socket_onClose;
    private _Socket_onConnect;
    private _Socket_onData;
    private _Reader_onMessage;
    private _Reader_onMessageQuery;
    private _Reader_onReply;
    private _Reader_onReplyQuery;
    private _Reader_onAck;
    private _Reader_onNak;
    private _Socket_onDrain;
    private _Socket_onEnd;
    private _Socket_onError;
    private _Socket_onLookup;
    private _Socket_onTimeout;
}
