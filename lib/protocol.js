"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const assert = require("assert");
const log_1 = require("./log");
const SOH = 0x01;
const STX = 0x02;
const ETX = 0x03;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
class UUID {
    constructor(uuid) {
        this._buffer = uuid ? uuid : crypto_1.randomBytes(16);
    }
    get bytes() {
        return this._buffer;
    }
    toString() {
        return this._buffer.toString('hex', 0, 4) + '-' +
            this._buffer.toString('hex', 4, 6) + '-' +
            this._buffer.toString('hex', 6, 8) + '-' +
            this._buffer.toString('hex', 8, 10) + '-' +
            this._buffer.toString('hex', 10, 16);
    }
}
exports.UUID = UUID;
var MessageReaderState;
(function (MessageReaderState) {
    MessageReaderState[MessageReaderState["SOH"] = 0] = "SOH";
    MessageReaderState[MessageReaderState["UUID"] = 1] = "UUID";
    MessageReaderState[MessageReaderState["STX"] = 2] = "STX";
    MessageReaderState[MessageReaderState["LENGTH_OF_LENGTH"] = 3] = "LENGTH_OF_LENGTH";
    MessageReaderState[MessageReaderState["LENGTH"] = 4] = "LENGTH";
    MessageReaderState[MessageReaderState["MESSAGE"] = 5] = "MESSAGE";
    MessageReaderState[MessageReaderState["ERROR"] = 6] = "ERROR";
})(MessageReaderState || (MessageReaderState = {}));
class MessageReader {
    constructor(handlers, options) {
        this._state = MessageReaderState.SOH;
        this._readStart = 0;
        this._possibleReadStart = 0;
        this._lastValueWasEndChar = true;
        this._uuidBuffer = Buffer.allocUnsafe(16);
        this._uuidBytesRead = 0;
        this._lengthOfLength = 0;
        this._length = 0;
        this._lengthBytesRead = 0;
        this._messageBytesRead = 0;
        this._log = log_1.create('ipc-reader');
        this._messageHandler = handlers.messageHandler || (() => { });
        this._replyHandler = handlers.replyHandler || (() => { });
        this._messageQueryHandler = handlers.messageQueryHandler || (() => { });
        this._replyQueryHandler = handlers.replyQueryHandler || (() => { });
        this._ackHandler = handlers.ackHandler || (() => { });
        this._nakHandler = handlers.nakHandler || (() => { });
        this._errorHandler = handlers.errorHandler || (() => { });
        if (options) {
            this._messageBuffer = Buffer.allocUnsafe(options.bufferSize);
        }
        else {
            this._messageBuffer = Buffer.allocUnsafe(1024 * 1024);
        }
        this._log.debug(`Created new message reader with buffer size of ${this._messageBuffer.length}`);
    }
    read(data) {
        this._log.debug(`Reading in ${data.length} bytes of data. Current state is ${this._state}`);
        this._readStart = 0;
        this._possibleReadStart = 0;
        for (let i = 0; i < data.length; i++) {
            switch (this._state) {
                case MessageReaderState.SOH:
                    if (data[i] != SOH) {
                        this._state = MessageReaderState.ERROR;
                        break;
                    }
                    this._readStart = i;
                    this._uuidBytesRead = 0;
                    this._state = MessageReaderState.UUID;
                    break;
                case MessageReaderState.UUID:
                    this._uuidBuffer[this._uuidBytesRead++] = data[i];
                    if (this._uuidBytesRead === 16) {
                        this._log.debug(`Read UUID: ${this._uuidBuffer}`);
                        this._state = MessageReaderState.STX;
                        break;
                    }
                    break;
                case MessageReaderState.STX:
                    if (data[i] != STX) {
                        if (data[i] == ACK) {
                            this._ack();
                            break;
                        }
                        if (data[i] == NAK) {
                            this._nak();
                            break;
                        }
                        this._state = MessageReaderState.ERROR;
                        break;
                    }
                    this._state = MessageReaderState.LENGTH_OF_LENGTH;
                    break;
                case MessageReaderState.LENGTH_OF_LENGTH:
                    if (data[i] < 128) {
                        this._length = data[i];
                        this._lengthOfLength = 0;
                        this._messageBytesRead = 0;
                        this._state = MessageReaderState.MESSAGE;
                        this._log.debug(`Read Length: ${this._length}`);
                        break;
                    }
                    this._length = 0;
                    this._lengthBytesRead = 0;
                    this._lengthOfLength = data[i] - 128;
                    if (this._lengthOfLength > 4) {
                        this._state = MessageReaderState.ERROR;
                    }
                    else {
                        this._log.debug(`Read Length of Length: ${this._lengthOfLength}`);
                        this._state = MessageReaderState.LENGTH;
                    }
                    break;
                case MessageReaderState.LENGTH:
                    this._length = this._length << 8 + data[i];
                    this._lengthBytesRead++;
                    if (this._lengthBytesRead === this._lengthOfLength) {
                        //Increase buffer to accommodate message size (max is Int32.MAX)
                        if (this._length > this._messageBuffer.length) {
                            this._messageBuffer = Buffer.allocUnsafe(this._length);
                        }
                        this._log.debug(`Read Length: ${this._length}`);
                        this._messageBytesRead = 0;
                        this._state = MessageReaderState.MESSAGE;
                    }
                    break;
                case MessageReaderState.MESSAGE:
                    if (this._messageBytesRead === this._length) {
                        switch (data[i]) {
                            case ETX:
                                (this._length > 0) ? this._message() : this._messageQuery();
                                break;
                            case EOT:
                                (this._length > 0) ? this._reply() : this._replyQuery();
                                break;
                            default:
                                this._state = MessageReaderState.ERROR;
                        }
                    }
                    this._messageBuffer[this._messageBytesRead++] = data[i];
                    break;
                case MessageReaderState.ERROR:
                    if (this._readStart < this._possibleReadStart) {
                        // There was a possible frame start along the way. 
                        // Throw away everything up to that point and restart
                        this._throw(data.slice(this._readStart, this._possibleReadStart));
                        i = this._possibleReadStart;
                        this._state = MessageReaderState.SOH;
                    }
                    // TODO - Handle some edge cases
                    // 1. Part of meesage read from previous buffer
                    // 2. Part of message read + possible frame boundary encountered from previous buffer  
                    break;
            }
            // Record where we see a possible frame boundry
            // If we discover this message is corrupt we can go back and try to start again from here
            if (data[i] == SOH && this._lastValueWasEndChar && this._possibleReadStart === this._readStart) {
                this._possibleReadStart = i;
            }
            this._lastValueWasEndChar = (data[i] === ACK || data[i] === NAK || data[i] === EOT || data[i] === EOT);
        }
        // End of buffer and we're in an error state
        if (this._state === MessageReaderState.ERROR) {
            // Throw away everything since last start and reset. 
            // If the corrupt message continues on next read then we'll pick that up and go back into error state
            this._throw(data.slice(this._readStart, data.length));
            this._state = MessageReaderState.SOH;
            this._log.error(`Discarded ${data.length - this._readStart} bytes of bad data.`);
        }
        this._log.debug(`Finished reading. Current state is ${this._state}`);
    }
    _ack() {
        this._log.debug(`Read ACK`);
        this._state = MessageReaderState.SOH;
        this._ackHandler(new UUID(this._uuidBuffer));
    }
    _nak() {
        this._log.debug(`Read NAK`);
        this._state = MessageReaderState.SOH;
        this._nakHandler(new UUID(this._uuidBuffer));
    }
    _message() {
        this._log.debug(`Read message`);
        this._state = MessageReaderState.SOH;
        this._messageHandler(new UUID(this._uuidBuffer), this._messageBuffer.slice(0, this._length));
    }
    _messageQuery() {
        this._log.debug(`Read message query`);
        this._state = MessageReaderState.SOH;
        this._messageQueryHandler(new UUID(this._uuidBuffer));
    }
    _reply() {
        this._log.debug(`Read reply`);
        this._state = MessageReaderState.SOH;
        this._replyHandler(new UUID(this._uuidBuffer), this._messageBuffer.slice(0, this._length));
    }
    _replyQuery() {
        this._log.debug(`Read reply query`);
        this._state = MessageReaderState.SOH;
        this._replyQueryHandler(new UUID(this._uuidBuffer));
    }
    _throw(badData) {
        this._log.debug(`Threw away ${badData.length} of unreadable data`);
        this._state = MessageReaderState.SOH;
        this._errorHandler(badData);
    }
}
exports.MessageReader = MessageReader;
class MessageWriter {
    constructor(options) {
        this._bufferPos = 0;
        this._emptyBuffer = Buffer.allocUnsafe(0);
        this._log = log_1.create('ipc-writer');
        if (options) {
            this._buffer = Buffer.allocUnsafe(options.bufferSize);
        }
        else {
            this._buffer = Buffer.allocUnsafe(1024);
        }
        this._log.debug(`Created new writer with buffer size of ${this._buffer.length}`);
    }
    writeMessage(id, message) {
        this._log.debug(`Writing ${message.length} byte message to buffer`);
        this._write(id, message, ETX);
        return this._bufferPos;
    }
    writeMessageQuery(id) {
        this._log.debug(`Writing message query to buffer`);
        this._write(id, this._emptyBuffer, ETX);
        return this._bufferPos;
    }
    writeReply(id, message) {
        this._log.debug(`Writing ${message.length} byte reply to buffer`);
        this._write(id, message, EOT);
        return this._bufferPos;
    }
    writeReplyQuery(id) {
        this._log.debug(`Writing reply query to buffer`);
        this._write(id, this._emptyBuffer, EOT);
        return this._bufferPos;
    }
    writeAck(id) {
        this._log.debug(`Writing ack to buffer`);
        this._write(id, this._emptyBuffer, ACK);
        return this._bufferPos;
    }
    writeNak(id) {
        this._log.debug(`Writing nak to buffer`);
        this._write(id, this._emptyBuffer, NAK);
        return this._bufferPos;
    }
    flush() {
        const length = this._bufferPos;
        this._bufferPos = 0;
        this._log.debug(`Flushing ${length} bytes from write buffer`);
        return this._buffer.slice(0, length);
    }
    _write(id, message, terminator) {
        assert([ETX, EOT, ACK, NAK].includes(terminator), "Invalid message terminator");
        assert(message.length <= 0xFFFFFFFF, "Message exceeds maximum length of UInt32.MAX.");
        const requiredBufferSpace = (terminator === ETX || terminator === EOT && message.length > 0) ?
            message.length + 24 :
            18;
        if (this._buffer.length - this._bufferPos < requiredBufferSpace) {
            throw new Error("Exceeded available space in write buffer.");
        }
        this._buffer.writeUInt8(SOH, this._bufferPos++);
        this._bufferPos += id.bytes.copy(this._buffer, this._bufferPos, 0);
        if (terminator === ETX || terminator === EOT) {
            this._buffer.writeUInt8(STX, this._bufferPos++);
            if (message.length > 0x7F) {
                const lengthOfLength = (message.length <= 0xFF) ? 1 :
                    ((message.length <= 0xFFFF) ? 2 :
                        (((message.length <= 0xFFFFFF) ? 3 : 4)));
                this._buffer.writeUInt8(lengthOfLength, this._bufferPos++);
                for (let i = lengthOfLength - 1; i >= 0; i--) {
                    this._buffer.writeUInt8(message.length >> (8 * i), this._bufferPos++);
                }
            }
            else {
                this._buffer.writeUInt8(message.length, this._bufferPos++);
            }
            if (message.length > 0) {
                message.copy(this._buffer, this._bufferPos, 0);
                this._bufferPos += message.length;
            }
        }
        this._buffer.writeUInt8(terminator, this._bufferPos++);
    }
}
exports.MessageWriter = MessageWriter;
class DefaultConfig {
    constructor(custom) {
        this.ackTimeoutMs = 1000;
        this.replyTimeoutMs = 5000;
        this.throwOnUnsolictedResponse = true;
        this.retryWithQuery = false;
        this.maxRetries = Infinity;
        this.ackTimeoutMs = (custom && custom.ackTimeoutMs) ?
            custom.ackTimeoutMs :
            this.ackTimeoutMs;
        this.replyTimeoutMs = (custom && custom.replyTimeoutMs) ?
            custom.replyTimeoutMs :
            this.replyTimeoutMs;
        this.throwOnUnsolictedResponse = (custom && custom.throwOnUnsolictedResponse) ?
            custom.throwOnUnsolictedResponse :
            this.throwOnUnsolictedResponse;
        this.retryWithQuery = (custom && custom.retryWithQuery) ?
            custom.retryWithQuery :
            this.retryWithQuery;
        this.maxRetries = (custom && custom.maxRetries) ?
            custom.maxRetries :
            this.maxRetries;
    }
}
exports.DefaultConfig = DefaultConfig;
//# sourceMappingURL=protocol.js.map