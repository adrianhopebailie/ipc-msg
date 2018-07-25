"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const protocol_1 = require("./protocol");
const log_1 = require("./log");
const net_1 = require("net");
var MessageState;
(function (MessageState) {
    MessageState[MessageState["NEW"] = 0] = "NEW";
    MessageState[MessageState["SENT"] = 1] = "SENT";
    MessageState[MessageState["RECEIVED"] = 2] = "RECEIVED";
    MessageState[MessageState["ACK"] = 3] = "ACK";
    MessageState[MessageState["NAK"] = 4] = "NAK";
    MessageState[MessageState["REPLY"] = 5] = "REPLY";
    MessageState[MessageState["TIMED_OUT"] = 6] = "TIMED_OUT";
    MessageState[MessageState["ERROR"] = 7] = "ERROR";
})(MessageState || (MessageState = {}));
var MessageType;
(function (MessageType) {
    MessageType[MessageType["MESSAGE"] = 0] = "MESSAGE";
    MessageType[MessageType["REQUEST"] = 1] = "REQUEST";
    MessageType[MessageType["REPLY"] = 2] = "REPLY";
})(MessageType || (MessageType = {}));
class SentMessage {
    constructor(id, data, type, config, replyCallback, ackCallback, nakCallback, retryCallback) {
        this._retries = 0;
        this._lastModified = new Date();
        this._id = id;
        this._data = data;
        this._type = type;
        this._config = config;
        this._replyCallback = replyCallback;
        this._ackCallback = ackCallback;
        this._nakCallback = nakCallback;
        this._retryCallback = retryCallback;
        this._state = MessageState.NEW;
    }
    _startTimer() {
        const interval = (this._state === MessageState.ACK) ? this._config.replyTimeoutMs : this._config.ackTimeoutMs;
        this._timer = setTimeout(() => {
            if (this._retries <= this._config.maxRetries) {
                this._retryCallback();
                this._retries++;
                this._startTimer();
            }
            else {
                this._state = MessageState.TIMED_OUT;
            }
        }, interval);
    }
    _stopTimer() {
        if (this._timer)
            clearTimeout(this._timer);
    }
    get id() {
        return this._id;
    }
    get type() {
        return this._type;
    }
    get data() {
        return this._data;
    }
    get reply() {
        return this._reply;
    }
    get retries() {
        return this._retries - 1;
    }
    get isComplete() {
        switch (this._state) {
            case MessageState.NAK:
            case MessageState.TIMED_OUT:
            case MessageState.ERROR:
            case MessageState.REPLY:
                return true;
            case MessageState.ACK:
                return this._type === MessageType.MESSAGE || this._type === MessageType.REPLY;
            default:
                return false;
        }
    }
    get lastModified() {
        return this._lastModified;
    }
    sent() {
        this._state = MessageState.SENT;
        this._startTimer();
    }
    ack() {
        this._stopTimer();
        switch (this._state) {
            case MessageState.SENT:
                this._state = MessageState.ACK;
                this._ackCallback();
                if (this._type === MessageType.REQUEST) {
                    this._startTimer();
                }
                break;
            case MessageState.ACK:
            case MessageState.REPLY:
                // Ignore - already got ACK or reply
                break;
            case MessageState.TIMED_OUT:
            case MessageState.ERROR:
            case MessageState.NAK:
                // TODO Should we log this?
                break;
        }
    }
    nak() {
        this._stopTimer();
        switch (this._state) {
            case MessageState.SENT:
            case MessageState.ACK:
                this._state = MessageState.NAK;
                this._nakCallback();
                break;
            case MessageState.REPLY:
            case MessageState.TIMED_OUT:
            case MessageState.ERROR:
            case MessageState.NAK:
                // TODO Should we log this?
                break;
        }
    }
    replyWith(data) {
        this._stopTimer();
        this._state = MessageState.REPLY;
        this._reply = data;
        this._replyCallback(data);
    }
}
exports.SentMessage = SentMessage;
class ReceivedMessage {
    constructor(id) {
        this._id = id;
        this._state = MessageState.RECEIVED;
        this._lastModified = new Date();
    }
    get id() {
        return this._id;
    }
    get state() {
        return this._state;
    }
    get replyMessage() {
        return this._reply;
    }
    get error() {
        return this._error;
    }
    get lastModified() {
        return this._lastModified;
    }
    ack() {
        this._state = MessageState.ACK;
        this._lastModified = new Date();
    }
    nak() {
        this._state = MessageState.NAK;
        this._lastModified = new Date();
    }
    reply(message) {
        this._state = MessageState.REPLY;
        this._lastModified = new Date();
        this._reply = message;
    }
    logError(error) {
        this._state = MessageState.REPLY;
        this._lastModified = new Date();
        this._error = error;
    }
}
exports.ReceivedMessage = ReceivedMessage;
class IpcSocket {
    constructor(config, protocolConfig) {
        this._id = config.id;
        this._sentMessages = new Map();
        this._sentRequests = new Map();
        this._sentReplies = new Map();
        this._receivedMessages = new Map();
        this._log = log_1.create('ipc-socket:' + config.id);
        if (config.socketOrPath instanceof net_1.Socket) {
            this._socket = config.socketOrPath;
        }
        else {
            this._socket = new net_1.Socket();
        }
        this._config = protocolConfig;
        this._socket.on('close', this._Socket_onClose.bind(this));
        this._socket.on('connect', this._Socket_onConnect.bind(this));
        this._socket.on('data', this._Socket_onData.bind(this));
        this._socket.on('drain', this._Socket_onDrain.bind(this));
        this._socket.on('end', this._Socket_onEnd.bind(this));
        this._socket.on('error', this._Socket_onError.bind(this));
        this._socket.on('lookup', this._Socket_onLookup.bind(this));
        this._socket.on('timeout', this._Socket_onTimeout.bind(this));
        this._reader = new protocol_1.MessageReader({
            messageHandler: this._Reader_onMessage.bind(this),
            messageQueryHandler: this._Reader_onMessageQuery.bind(this),
            replyHandler: this._Reader_onReply.bind(this),
            replyQueryHandler: this._Reader_onReplyQuery.bind(this),
            ackHandler: this._Reader_onAck.bind(this),
            nakHandler: this._Reader_onNak.bind(this)
        });
        this._writer = new protocol_1.MessageWriter({
            bufferSize: 1024
        });
        this._messageHandler = config.messageHandler;
        this._errorHandler = config.errorHandler;
        if (!(config.socketOrPath instanceof net_1.Socket)) {
            this._log.debug(`Connecting to ${config.socketOrPath}...`);
            this._socket.connect(config.socketOrPath);
        }
    }
    get id() {
        return this._id;
    }
    set messageHandler(handler) {
        this._messageHandler = handler;
    }
    set errorHandler(handler) {
        this._errorHandler = handler;
    }
    sendMessage(data) {
        return new Promise((ack, nak) => {
            const id = new protocol_1.UUID();
            const message = new SentMessage(id, data, MessageType.MESSAGE, this._config, () => { }, ack, nak, this._retry.bind(this, id, data));
            this._sentMessages.set(message.id + '', message);
            this._writer.writeMessage(message.id, data);
            this._socket.write(this._writer.flush(), () => {
                this._log.debug(`Message ${this._id} sent`);
                message.sent();
            });
        });
    }
    sendRequest(data, ack) {
        return new Promise((respond, nak) => {
            const id = new protocol_1.UUID();
            const request = new SentMessage(id, data, MessageType.REQUEST, this._config, respond, ack, nak, this._retry.bind(this, id, data));
            this._sentRequests.set(request.id + '', request);
            this._writer.writeMessage(request.id, data);
            this._socket.write(this._writer.flush(), () => {
                this._log.debug(`Message ${this._id} sent`);
                request.sent();
            });
        });
    }
    _createAndSendReply(id, data, ack, nak, message) {
        const replyMessage = new SentMessage(id, data, MessageType.REPLY, this._config, () => { }, ack, nak, this._retry.bind(this, id, data, true));
        this._sentReplies.set(id + '', replyMessage);
        this._sendReply(id, data, message.reply.bind(message, replyMessage));
    }
    _retry(id, data, isReply = false) {
        const writer = (isReply) ?
            (this._config.retryWithQuery) ?
                this._writer.writeReplyQuery.bind(this._writer) :
                this._writer.writeReply.bind(this._writer) :
            (this._config.retryWithQuery) ?
                this._writer.writeMessageQuery.bind(this._writer) :
                this._writer.writeMessage.bind(this._writer);
        writer(id, data);
        this._socket.write(this._writer.flush());
    }
    _sendReply(id, data, sent) {
        this._writer.writeReply(id, data);
        this._socket.write(this._writer.flush(), sent);
    }
    _sendAck(id, sent) {
        this._writer.writeAck(id);
        this._socket.write(this._writer.flush(), sent);
    }
    _sendNak(id, sent) {
        this._writer.writeNak(id);
        this._socket.write(this._writer.flush(), sent);
    }
    _resendResponse(prevMessage) {
        switch (prevMessage.state) {
            case MessageState.RECEIVED:
                //Message never (or not yet) handled by message handler (ignore to avoid DoS attacks)
                break;
            case MessageState.ACK:
                this._sendAck(prevMessage.id);
                break;
            case MessageState.NAK:
                this._sendNak(prevMessage.id);
                break;
            case MessageState.REPLY:
                this._sendReply(prevMessage.id, prevMessage.replyMessage.data);
                break;
        }
    }
    _callMessageHandler(data, respond) {
        if (this._messageHandler) {
            this._messageHandler(this, data, respond);
        }
        else {
            this._log.error(`Incoming message discarded. No handler listening.`);
            throw new Error("No message handler listening.");
        }
    }
    _callErrorHandler(error) {
        this._log.error(error);
        if (this._errorHandler) {
            this._errorHandler(this, error);
        }
    }
    _Socket_onClose(hadError) {
        this._log.info(`Socket ${this._id} closed with ${hadError ? '' : ' no'} errors`);
    }
    _Socket_onConnect() {
        this._log.debug(`Socket ${this._id} Connected`);
    }
    _Socket_onData(data) {
        this._log.debug(`Socket ${this._id} received ${data.byteLength} bytes of data`);
        this._log.trace('data received', data);
        this._reader.read(data);
    }
    _Reader_onMessage(id, data) {
        this._log.debug(`Got message ${id} containing ${data.byteLength} bytes of data`);
        this._log.trace('message', id, data);
        // Idempotency - resend old reply or ack
        const prevMessage = this._receivedMessages.get(id + '');
        if (prevMessage) {
            this._resendResponse(prevMessage);
        }
        else {
            const receivedMessage = new ReceivedMessage(id);
            this._receivedMessages.set(id + '', receivedMessage);
            try {
                this._callMessageHandler(data, (reply) => {
                    return new Promise((replyAck, replyNak) => {
                        if (reply) {
                            if (reply instanceof Promise) {
                                // We got a promise so send an ACK first
                                this._sendAck(id, receivedMessage.ack.bind(receivedMessage));
                                reply.then(asyncReply => {
                                    // Now send the reply
                                    this._createAndSendReply(id, asyncReply, replyAck, replyNak, receivedMessage);
                                }).catch((error) => {
                                    this._log.error(`Message handler threw an error handling message ${id} after sending ACK`, error);
                                    this._sendNak(id, receivedMessage.nak.bind(receivedMessage));
                                });
                            }
                            else {
                                this._createAndSendReply(id, reply, replyAck, replyNak, receivedMessage);
                            }
                        }
                        else {
                            this._sendAck(id);
                        }
                    });
                });
            }
            catch (e) {
                this._log.error(`Error processing incoming message ${id}.`, e);
                receivedMessage.logError(e);
                this._sendNak(id);
            }
        }
    }
    _Reader_onMessageQuery(id) {
        this._log.debug(`Got message query ${id}`);
        this._log.trace('message query', id);
        const prevMessage = this._receivedMessages.get(id + '');
        if (prevMessage) {
            this._resendResponse(prevMessage);
        }
        else {
            this._sendNak(id);
        }
    }
    _Reader_onReply(id, data) {
        const request = this._sentRequests.get(id + '');
        if (request) {
            this._log.debug(`Got reply to message ${this._id} containing ${data.byteLength} bytes of data`);
            this._log.trace('reply', data);
            request.replyWith(data);
            this._sendAck(id);
        }
        else {
            console.log(request);
            //Unsolicited reply
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited reply ${id} received.`));
            }
            this._sendNak(id);
        }
    }
    _Reader_onReplyQuery(id) {
        this._log.debug(`Got reply query ${id}`);
        this._log.trace('reply query', id);
        const request = this._sentRequests.get(id + '');
        if (request && request.reply) {
            this._sendAck(id);
        }
        else {
            console.log(request);
            //Unsolicited reply
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited reply ${id} received.`));
            }
            this._sendNak(id);
        }
    }
    _Reader_onAck(id) {
        const id_string = id.toString();
        const message = this._sentMessages.get(id_string) ||
            this._sentReplies.get(id_string) ||
            this._sentRequests.get(id_string);
        if (message) {
            message.ack();
            this._log.debug(`Got ACK for message ${this._id}`);
        }
        else {
            console.log(message);
            //Unsolicited ACK
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited ACK ${id} received.`));
            }
        }
    }
    _Reader_onNak(id) {
        const id_string = id.toString();
        const message = this._sentMessages.get(id_string) ||
            this._sentReplies.get(id_string) ||
            this._sentRequests.get(id_string);
        if (message) {
            message.nak();
            this._log.debug(`Got NAK for message ${this._id}`);
        }
        else {
            console.log(message);
            //Unsolicited NAK
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited ACK ${id} received.`));
            }
        }
    }
    _Socket_onDrain() {
        this._log.debug(`Socket ${this._id} output buffer drained`);
    }
    _Socket_onEnd() {
        this._log.debug(`Socket ${this._id} end`);
    }
    _Socket_onError(error) {
        this._log.error(`Socket ${this._id} error`, error);
        // TODO Close socket
    }
    _Socket_onLookup() {
        // No-op
    }
    _Socket_onTimeout() {
        this._log.debug(`Socket ${this._id} timeout`);
    }
}
exports.IpcSocket = IpcSocket;
//# sourceMappingURL=socket.js.map