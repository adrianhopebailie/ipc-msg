/// <reference types="node" />
export declare class UUID {
    private _buffer;
    constructor(uuid?: Buffer);
    readonly bytes: Buffer;
    toString(): string;
}
export interface MessageReaderHandlers {
    messageHandler?: (id: UUID, data: Buffer) => void;
    replyHandler?: (id: UUID, data: Buffer) => void;
    messageQueryHandler?: (id: UUID) => void;
    replyQueryHandler?: (id: UUID) => void;
    ackHandler?: (id: UUID) => void;
    nakHandler?: (id: UUID) => void;
    errorHandler?: (errorData: Buffer) => void;
}
export interface MessageReaderOptions {
    bufferSize: number;
}
export interface MessageWriterOptions {
    bufferSize: number;
}
export declare class MessageReader {
    private _state;
    private _readStart;
    private _possibleReadStart;
    private _lastValueWasEndChar;
    private _uuidBuffer;
    private _uuidBytesRead;
    private _lengthOfLength;
    private _length;
    private _lengthBytesRead;
    private _messageBuffer;
    private _messageBytesRead;
    private _messageHandler;
    private _replyHandler;
    private _messageQueryHandler;
    private _replyQueryHandler;
    private _ackHandler;
    private _nakHandler;
    private _errorHandler;
    private _log;
    constructor(handlers: MessageReaderHandlers, options?: MessageReaderOptions);
    read(data: Buffer): void;
    private _ack;
    private _nak;
    private _message;
    private _messageQuery;
    private _reply;
    private _replyQuery;
    private _throw;
}
export declare class MessageWriter {
    private _buffer;
    private _bufferPos;
    private _emptyBuffer;
    private _log;
    constructor(options?: MessageWriterOptions);
    writeMessage(id: UUID, message: Buffer): number;
    writeMessageQuery(id: UUID): number;
    writeReply(id: UUID, message: Buffer): number;
    writeReplyQuery(id: UUID): number;
    writeAck(id: UUID): number;
    writeNak(id: UUID): number;
    flush(): Buffer;
    private _write;
}
export interface Config {
    ackTimeoutMs: number;
    replyTimeoutMs: number;
    throwOnUnsolictedResponse: boolean;
    retryWithQuery: boolean;
    maxRetries: number;
}
export declare class DefaultConfig implements Config {
    constructor(custom?: {
        ackTimeoutMs?: number;
        replyTimeoutMs?: number;
        throwOnUnsolictedResponse?: boolean;
        retryWithQuery?: boolean;
        maxRetries?: number;
    });
    ackTimeoutMs: number;
    replyTimeoutMs: number;
    throwOnUnsolictedResponse: boolean;
    retryWithQuery: boolean;
    maxRetries: number;
}
