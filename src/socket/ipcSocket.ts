import { Socket } from 'net'
import { create as createLogger, Logger } from '../log'
import { IProtocolConfig as ProtocolConfig, MessageReader, MessageWriter, UUID } from '../protocol'
import { IpcSocketServer } from '../server'
import ReceivedMessage from './receivedMessage'
import SentMessage from './sentMessage'

export enum MessageState {
    NEW,
    SENT,
    RECEIVED,
    ACK,
    NAK,
    REPLY,
    TIMED_OUT,
    ERROR,
}
export enum MessageType {
    MESSAGE,
    REQUEST,
    REPLY,
}
export type MessageHandler = (
    socket: IpcSocket,
    data: Buffer,
    respond: (reply?: Promise<Buffer> | Buffer) => Promise<void>,
) => void
export type ErrorHandler = (socket: IpcSocket | IpcSocketServer, error: Error) => void
export type AckCallback = (value?: void | PromiseLike<void> | undefined) => void
export type NakCallback = (error?: Error) => void
export interface ISocketConfig {
    id: string
    socketOrPath: Socket | string
    messageHandler?: MessageHandler
    errorHandler?: ErrorHandler
}

export default class IpcSocket {
    private _id: string
    private _config: ProtocolConfig
    private _socket: Socket
    private _sentMessages: Map<string, SentMessage>
    private _sentRequests: Map<string, SentMessage>
    private _sentReplies: Map<string, SentMessage>
    private _receivedMessages: Map<string, ReceivedMessage>
    private _reader: MessageReader
    private _writer: MessageWriter
    private _messageHandler?: MessageHandler
    private _errorHandler?: ErrorHandler
    private _log: Logger
    constructor(config: ISocketConfig, protocolConfig: ProtocolConfig) {
        this._id = config.id
        this._sentMessages = new Map<string, SentMessage>()
        this._sentRequests = new Map<string, SentMessage>()
        this._sentReplies = new Map<string, SentMessage>()
        this._receivedMessages = new Map<string, ReceivedMessage>()
        this._log = createLogger('ipc-socket:' + config.id)

        if (config.socketOrPath instanceof Socket) {
            this._socket = config.socketOrPath
        } else {
            this._socket = new Socket()
        }

        this._config = protocolConfig

        this._socket.on('close', this._Socket_onClose.bind(this))
        this._socket.on('connect', this._Socket_onConnect.bind(this))
        this._socket.on('data', this._Socket_onData.bind(this))
        this._socket.on('drain', this._Socket_onDrain.bind(this))
        this._socket.on('end', this._Socket_onEnd.bind(this))
        this._socket.on('error', this._Socket_onError.bind(this))
        this._socket.on('lookup', this._Socket_onLookup.bind(this))
        this._socket.on('timeout', this._Socket_onTimeout.bind(this))

        this._reader = new MessageReader({
            ackHandler: this._Reader_onAck.bind(this),
            messageHandler: this._Reader_onMessage.bind(this),
            messageQueryHandler: this._Reader_onMessageQuery.bind(this),
            nakHandler: this._Reader_onNak.bind(this),
            replyHandler: this._Reader_onReply.bind(this),
            replyQueryHandler: this._Reader_onReplyQuery.bind(this),
        })

        this._writer = new MessageWriter({
            bufferSize: 1024,
        })

        this._messageHandler = config.messageHandler
        this._errorHandler = config.errorHandler

        if (!(config.socketOrPath instanceof Socket)) {
            this._log.debug(`Connecting to ${config.socketOrPath}...`)
            this._socket.connect(config.socketOrPath)
        }
    }

    public get id(): string {
        return this._id
    }

    public set messageHandler(handler: MessageHandler) {
        this._messageHandler = handler
    }

    public set errorHandler(handler: ErrorHandler) {
        this._errorHandler = handler
    }

    public sendMessage(data: Buffer): Promise<void> {
        return new Promise<void>((ack, nak) => {
            const id = new UUID()
            const message = new SentMessage(
                id,
                data,
                MessageType.MESSAGE,
                this._config,
                () => {
                    /* NOOP */
                },
                ack,
                nak,
                this._retry.bind(this, id, data),
            )
            this._sentMessages.set(message.id + '', message)
            this._writer.writeMessage(message.id, data)
            this._socket.write(this._writer.flush(), () => {
                this._log.debug(`Message ${this._id} sent`)
                message.sent()
            })
        })
    }

    public sendRequest(data: Buffer, ack: () => void): Promise<Buffer> {
        return new Promise<Buffer>((respond, nak) => {
            const id = new UUID()
            const request = new SentMessage(
                id,
                data,
                MessageType.REQUEST,
                this._config,
                respond,
                ack,
                nak,
                this._retry.bind(this, id, data),
            )
            this._sentRequests.set(request.id + '', request)
            this._writer.writeMessage(request.id, data)
            this._socket.write(this._writer.flush(), () => {
                this._log.debug(`Message ${this._id} sent`)
                request.sent()
            })
        })
    }

    private _createAndSendReply(id: UUID, data: Buffer, ack: AckCallback, nak: NakCallback, message: ReceivedMessage) {
        const replyMessage = new SentMessage(
            id,
            data,
            MessageType.REPLY,
            this._config,
            () => {
                /* NOOP */
            },
            ack,
            nak,
            this._retry.bind(this, id, data, true),
        )
        this._sentReplies.set(id + '', replyMessage)
        this._sendReply(id, data, message.reply.bind(message, replyMessage))
    }

    private _retry(id: UUID, data: Buffer, isReply: boolean = false) {
        const writer = isReply
            ? this._config.retryWithQuery
                ? this._writer.writeReplyQuery.bind(this._writer)
                : this._writer.writeReply.bind(this._writer)
            : this._config.retryWithQuery
                ? this._writer.writeMessageQuery.bind(this._writer)
                : this._writer.writeMessage.bind(this._writer)
        writer(id, data)
        this._socket.write(this._writer.flush())
    }

    private _sendReply(id: UUID, data: Buffer, sent?: AckCallback): void {
        this._writer.writeReply(id, data)
        this._socket.write(this._writer.flush(), sent)
    }

    private _sendAck(id: UUID, sent?: AckCallback): void {
        this._writer.writeAck(id)
        this._socket.write(this._writer.flush(), sent)
    }

    private _sendNak(id: UUID, sent?: AckCallback) {
        this._writer.writeNak(id)
        this._socket.write(this._writer.flush(), sent)
    }

    private _resendResponse(prevMessage: ReceivedMessage) {
        switch (prevMessage.state) {
            case MessageState.RECEIVED:
                // Message never (or not yet) handled by message handler (ignore to avoid DoS attacks)
                break
            case MessageState.ACK:
                this._sendAck(prevMessage.id)
                break
            case MessageState.NAK:
                this._sendNak(prevMessage.id)
                break
            case MessageState.REPLY:
                this._sendReply(prevMessage.id, prevMessage.replyMessage!.data)
                break
        }
    }

    private _callMessageHandler(
        data: Buffer,
        respond: (reply: Promise<Buffer> | Buffer | void) => Promise<void>,
    ): void {
        if (this._messageHandler) {
            this._messageHandler(this, data, respond)
        } else {
            this._log.error(`Incoming message discarded. No handler listening.`)
            throw new Error('No message handler listening.')
        }
    }

    private _callErrorHandler(error: Error): void {
        this._log.error(error)
        if (this._errorHandler) {
            this._errorHandler(this, error)
        }
    }

    private _Socket_onClose(hadError: boolean): void {
        this._log.info(`Socket ${this._id} closed with ${hadError ? '' : ' no'} errors`)
    }
    private _Socket_onConnect(): void {
        this._log.debug(`Socket ${this._id} Connected`)
    }
    private _Socket_onData(data: Buffer): void {
        this._log.debug(`Socket ${this._id} received ${data.byteLength} bytes of data`)
        this._log.trace('data received', data)
        this._reader.read(data)
    }
    private _Reader_onMessage(id: UUID, data: Buffer): void {
        this._log.debug(`Got message ${id} containing ${data.byteLength} bytes of data`)
        this._log.trace('message', id, data)

        // Idempotency - resend old reply or ack
        const prevMessage = this._receivedMessages.get(id + '')
        if (prevMessage) {
            this._resendResponse(prevMessage)
        } else {
            const receivedMessage = new ReceivedMessage(id)
            this._receivedMessages.set(id + '', receivedMessage)
            try {
                this._callMessageHandler(data, (reply: void | Buffer | Promise<Buffer>) => {
                    return new Promise<void>((replyAck, replyNak) => {
                        if (reply) {
                            if (reply instanceof Promise) {
                                // We got a promise so send an ACK first
                                this._sendAck(id, receivedMessage.ack.bind(receivedMessage))
                                reply
                                    .then(asyncReply => {
                                        // Now send the reply
                                        this._createAndSendReply(id, asyncReply, replyAck, replyNak, receivedMessage)
                                    })
                                    .catch(error => {
                                        this._log.error(
                                            `Message handler threw an error handling message ${id} after sending ACK`,
                                            error,
                                        )
                                        this._sendNak(id, receivedMessage.nak.bind(receivedMessage))
                                    })
                            } else {
                                this._createAndSendReply(id, reply, replyAck, replyNak, receivedMessage)
                            }
                        } else {
                            this._sendAck(id)
                        }
                    })
                })
            } catch (e) {
                this._log.error(`Error processing incoming message ${id}.`, e)
                receivedMessage.logError(e)
                this._sendNak(id)
            }
        }
    }
    private _Reader_onMessageQuery(id: UUID): void {
        this._log.debug(`Got message query ${id}`)
        this._log.trace('message query', id)
        const prevMessage = this._receivedMessages.get(id + '')
        if (prevMessage) {
            this._resendResponse(prevMessage)
        } else {
            this._sendNak(id)
        }
    }
    private _Reader_onReply(id: UUID, data: Buffer): void {
        const request = this._sentRequests.get(id + '')
        if (request) {
            this._log.debug(`Got reply to message ${this._id} containing ${data.byteLength} bytes of data`)
            this._log.trace('reply', data)
            request.replyWith(data)
            this._sendAck(id)
        } else {
            // Unsolicited reply
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited reply ${id} received.`))
            }
            this._sendNak(id)
        }
    }
    private _Reader_onReplyQuery(id: UUID): void {
        this._log.debug(`Got reply query ${id}`)
        this._log.trace('reply query', id)
        const request = this._sentRequests.get(id + '')
        if (request && request.reply) {
            this._sendAck(id)
        } else {
            // Unsolicited reply
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited reply ${id} received.`))
            }
            this._sendNak(id)
        }
    }
    private _Reader_onAck(id: UUID): void {
        const idAsString = id.toString()
        const message =
            this._sentMessages.get(idAsString) ||
            this._sentReplies.get(idAsString) ||
            this._sentRequests.get(idAsString)
        if (message) {
            message.ack()
            this._log.debug(`Got ACK for message ${this._id}`)
        } else {
            // Unsolicited ACK
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited ACK ${id} received.`))
            }
        }
    }
    private _Reader_onNak(id: UUID): void {
        const idAsString = id.toString()
        const message =
            this._sentMessages.get(idAsString) ||
            this._sentReplies.get(idAsString) ||
            this._sentRequests.get(idAsString)
        if (message) {
            message.nak()
            this._log.debug(`Got NAK for message ${this._id}`)
        } else {
            // Unsolicited NAK
            if (this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited ACK ${id} received.`))
            }
        }
    }
    private _Socket_onDrain() {
        this._log.debug(`Socket ${this._id} output buffer drained`)
    }
    private _Socket_onEnd() {
        this._log.debug(`Socket ${this._id} end`)
    }
    private _Socket_onError(error: Error) {
        this._log.error(`Socket ${this._id} error`, error)
        // TODO Close socket
    }
    private _Socket_onLookup() {
        // No-op
    }
    private _Socket_onTimeout() {
        this._log.debug(`Socket ${this._id} timeout`)
    }
}
