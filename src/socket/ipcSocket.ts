import { Socket, SocketConnectOpts } from 'net'
import { CachedMessage } from '.'
import { create as createLogger, Logger } from '../log'
import { MessageReader, MessageWriter, ProtocolConfig, UUID } from '../protocol'
import { IpcSocketServer } from '../server'
import ReceivedMessage from './receivedMessage'
import SentMessage from './sentMessage'

enum ConnectionState {
    IDLE,
    CONNECTING,
    CONNECTED,
    CLOSING,
    DESTROYED,
}
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
export interface SocketConfig {
    id: string
    messageHandler?: MessageHandler
    errorHandler?: ErrorHandler
    connectTimeoutMs?: number
    maxReconnects?: number
}

export default class IpcSocket {
    private _id: string
    private _config: ProtocolConfig
    private _connectTimeoutMs: number
    private _maxReconnects: number
    private _socket: Socket
    private _connectOptions?: SocketConnectOpts
    private _state: ConnectionState
    private _reconnectAttempts = 0
    private _sentMessages: Map<string, SentMessage>
    private _sentRequests: Map<string, SentMessage>
    private _sentReplies: Map<string, SentMessage>
    private _receivedMessages: Map<string, ReceivedMessage>
    private _reader: MessageReader
    private _writer: MessageWriter
    private _messageHandler?: MessageHandler
    private _errorHandler?: ErrorHandler
    private _log: Logger
    private _gcIntervalMs: number = 1000
    private _gcExpiryMs: number = 5 * 60 * 1000
    constructor(config: SocketConfig, protocolConfig: ProtocolConfig, socket?: Socket) {
        this._id = config.id
        this._sentMessages = new Map<string, SentMessage>()
        this._sentRequests = new Map<string, SentMessage>()
        this._sentReplies = new Map<string, SentMessage>()
        this._receivedMessages = new Map<string, ReceivedMessage>()
        this._log = createLogger('ipc-socket:' + config.id)

        this._config = protocolConfig
        this._connectTimeoutMs = config.connectTimeoutMs || 5000
        this._maxReconnects = config.maxReconnects || 5

        this._state = socket ? ConnectionState.CONNECTED : ConnectionState.IDLE

        this._socket = socket || new Socket()
        this._bindSocketEvents()

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
    }

    public get id(): string {
        return this._id
    }

    public get connected(): boolean {
        return this._state === ConnectionState.CONNECTED
    }

    public set messageHandler(handler: MessageHandler) {
        this._messageHandler = handler
    }

    public set errorHandler(handler: ErrorHandler) {
        this._errorHandler = handler
    }

    public async connect(options: SocketConnectOpts): Promise<IpcSocket> {
        if (this._state === ConnectionState.CONNECTED || this._state === ConnectionState.CONNECTING) {
            return Promise.reject(new Error('Socket already connected/connecting.'))
        }
        this._state = ConnectionState.CONNECTING
        this._connectOptions = options
        this._log.debug(`Connecting: ${JSON.stringify(options)}...`)
        return new Promise<IpcSocket>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this._state = ConnectionState.IDLE
                reject(new Error('Timed out trying to connect.'))
            }, this._connectTimeoutMs)
            this._socket.connect(
                options,
                () => {
                    clearTimeout(timeout)
                    setTimeout(this._gcMessages.bind(this), this._gcIntervalMs)
                    resolve(this)
                },
            )
        })
    }

    public async sendMessage(data: Buffer): Promise<void> {
        if (this._state !== ConnectionState.CONNECTED) {
            throw new Error('State error. Socket is not connected or is closing.')
        }
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
        if (this._state !== ConnectionState.CONNECTED) {
            throw new Error('State error. Socket is not connected or is closing.')
        }
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

    public async close() {
        this._log.debug('Closing client...')
        this._state = ConnectionState.CLOSING
        this._gcExpiryMs = 0
        this._gcIntervalMs = 500
        this._gcMessages()
        return new Promise<void>(closed => {
            const cachedMessages = [this._sentMessages, this._sentReplies, this._sentRequests, this._receivedMessages]
                .map(messages => messages.size)
                .reduce((p, c) => p + c)
            if (cachedMessages === 0) {
                this.destroy()
                closed()
            } else {
                closed(
                    new Promise(timeout => {
                        setTimeout(() => timeout(this.close()), 500)
                    }),
                )
            }
        })
    }

    public destroy(err?: Error) {
        this._state = ConnectionState.DESTROYED
        this._socket.destroy(err)
    }

    private _bindSocketEvents() {
        this._socket.on('close', this._Socket_onClose.bind(this))
        this._socket.on('connect', this._Socket_onConnect.bind(this))
        this._socket.on('data', this._Socket_onData.bind(this))
        this._socket.on('drain', this._Socket_onDrain.bind(this))
        this._socket.on('end', this._Socket_onEnd.bind(this))
        this._socket.on('error', this._Socket_onError.bind(this))
        this._socket.on('lookup', this._Socket_onLookup.bind(this))
        this._socket.on('timeout', this._Socket_onTimeout.bind(this))
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

    private _gcMessages() {
        ;[this._sentMessages, this._sentReplies, this._sentRequests, this._receivedMessages].forEach(
            (messages: Map<string, CachedMessage>) => {
                messages.forEach((message, messageId) => {
                    if (Date.now() - message.lastModified > this._gcExpiryMs) {
                        messages.delete(messageId)
                    }
                })
            },
        )
        setTimeout(this._gcMessages.bind(this), this._gcIntervalMs)
    }

    private _Socket_onClose(hadError: boolean): void {
        this._state = ConnectionState.DESTROYED
        this._log.info(`Socket ${this._id} closed with${hadError ? '' : ' no'} errors`)
    }
    private _Socket_onConnect(): void {
        this._state = ConnectionState.CONNECTED
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
            request.gotReply(data)
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
        // No-op - We don't allow half-open sockets
    }
    private _Socket_onError(error: Error) {
        this._log.error(`Socket ${this._id} error`, error)
        this._state = ConnectionState.DESTROYED
        this._socket.destroy(error)
        this._socket.unref()
        if (this._connectOptions && this._reconnectAttempts < this._maxReconnects) {
            // Client socket - attempt to reconnect
            this._socket = new Socket()
            this._bindSocketEvents()
            this._reconnectAttempts++
            this.connect(this._connectOptions)
        }
    }
    private _Socket_onLookup() {
        // No-op - Only applies to network sockets
    }
    private _Socket_onTimeout() {
        this._log.debug(`Socket ${this._id} idle timeout`)
    }
}
