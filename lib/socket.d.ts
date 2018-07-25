/// <reference types="node" />
import { UUID, Config as ProtocolConfig } from './protocol';
import { Socket } from 'net';
import { IpcSocketServer } from './server';
declare enum MessageState {
    NEW = 0,
    SENT = 1,
    RECEIVED = 2,
    ACK = 3,
    NAK = 4,
    REPLY = 5,
    TIMED_OUT = 6,
    ERROR = 7
}
declare enum MessageType {
    MESSAGE = 0,
    REQUEST = 1,
    REPLY = 2
}
export declare class SentMessage {
    private _id;
    private _data;
    private _reply?;
    private _type;
    private _state;
    private _timer?;
    private _retries;
    private _config;
    private _replyCallback;
    private _ackCallback;
    private _nakCallback;
    private _retryCallback;
    private _lastModified;
    constructor(id: UUID, data: Buffer, type: MessageType, config: ProtocolConfig, replyCallback: (reply: Buffer) => void, ackCallback: () => void, nakCallback: () => void, retryCallback: () => void);
    private _startTimer;
    private _stopTimer;
    readonly id: UUID;
    readonly type: MessageType;
    readonly data: Buffer;
    readonly reply: Buffer | undefined;
    readonly retries: number;
    readonly isComplete: boolean;
    readonly lastModified: Date;
    sent(): void;
    ack(): void;
    nak(): void;
    replyWith(data: Buffer): void;
}
export declare class ReceivedMessage {
    private _id;
    private _state;
    private _lastModified;
    private _reply?;
    private _error?;
    constructor(id: UUID);
    readonly id: UUID;
    readonly state: MessageState;
    readonly replyMessage: SentMessage | undefined;
    readonly error: Error | undefined;
    readonly lastModified: Date;
    ack(): void;
    nak(): void;
    reply(message: SentMessage): void;
    logError(error: Error): void;
}
export declare type MessageHandler = (socket: IpcSocket, data: Buffer, respond: (reply?: Promise<Buffer> | Buffer) => Promise<void>) => void;
export declare type ErrorHandler = (socket: IpcSocket | IpcSocketServer, error: Error) => void;
export declare type ResolveCallback = (value?: void | PromiseLike<void> | undefined) => void;
export declare type RejectCallback = (error?: Error) => void;
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
    private _log;
    constructor(config: SocketConfig, protocolConfig: ProtocolConfig);
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
export {};
