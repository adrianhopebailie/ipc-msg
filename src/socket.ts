import { UUID, MessageReader, MessageWriter, Config as ProtocolConfig } from './protocol'
import { create as createLogger } from './log'
import { Socket } from 'net'
const log = createLogger('ipc-socket')

enum MessageState {NEW, SENT, RECEIVED, ACK, NAK, REPLY, TIMED_OUT, ERROR}
enum MessageType {MESSAGE, REQUEST, REPLY}
class SentMessage {

    private _id: UUID
    private _data: Buffer
    private _reply?: Buffer
    private _type: MessageType
    private _state: MessageState
    private _timer?: NodeJS.Timer
    private _retries = 0
    private _config: ProtocolConfig
    private _replyCallback: (reply: Buffer) => void
    private _ackCallback: () => void
    private _nakCallback: () => void
    private _retryCallback: () => void
    private _lastModified = new Date()

    constructor(id: UUID, data: Buffer, type: MessageType, config: ProtocolConfig, 
            replyCallback: (reply: Buffer) => void, 
            ackCallback: () => void,
            nakCallback: () => void,
            retryCallback: () => void) {

        this._id = id
        this._data = data
        this._type = type
        this._config = config
        this._replyCallback = replyCallback
        this._ackCallback = ackCallback
        this._nakCallback = nakCallback
        this._retryCallback = retryCallback
        this._state = MessageState.NEW        
    }

    private _startTimer() {
        const interval = (this._state === MessageState.ACK) ? this._config.replyTimeoutMs : this._config.ackTimeoutMs
        this._timer = setTimeout(() => {
            if(this._retries <= this._config.maxRetries) {
                this._retryCallback()
                this._retries++
                this._startTimer()
            } else {
                this._state = MessageState.TIMED_OUT                
            }
        }, interval)        
    }
    private _stopTimer() {
        if(this._timer) clearTimeout(this._timer!)
    }
    public get id() : UUID {
        return this._id
    }    
    public get type() : MessageType {
        return this._type
    }

    public get data() : Buffer {
        return this._data
    }

    public get reply() : Buffer | undefined {
        return this._reply
    }

    public get retries() : number {
        return this._retries - 1
    }

    public get isComplete() : boolean {

        switch (this._state) {
            case MessageState.NAK:
            case MessageState.TIMED_OUT:
            case MessageState.ERROR:
            case MessageState.REPLY:
                return true
            case MessageState.ACK: 
                return this._type === MessageType.MESSAGE || this._type === MessageType.REPLY
            default:
                return false
        }
    }

    public get lastModified() : Date {
        return this._lastModified
    }    

    public sent() : void {
        log.debug(`Message ${this._id} sent`)
        this._state = MessageState.SENT
        this._startTimer()
    }

    public ack() : void {
        log.debug(`Got ACK for message ${this._id}`)
        this._stopTimer()
        switch(this._state) {
            case MessageState.SENT:
                this._state = MessageState.ACK
                this._ackCallback()
                if(this._type === MessageType.REQUEST) {
                    this._startTimer()
                }
            break

            case MessageState.ACK:
            case MessageState.REPLY:
                // Ignore - already got ACK or reply
            break

            case MessageState.TIMED_OUT:
            case MessageState.ERROR:
            case MessageState.NAK:
                // TODO Should we log this?
            break              
        }

    }
    public nak() : void {        
        log.debug(`Got NAK for message ${this._id}`)
        this._stopTimer()
        switch(this._state) {
            case MessageState.SENT:
            case MessageState.ACK:
                this._state = MessageState.NAK
                this._nakCallback()
            break

            case MessageState.REPLY:
            case MessageState.TIMED_OUT:
            case MessageState.ERROR:
            case MessageState.NAK:
                // TODO Should we log this?
            break              
        }    }
    public replyWith(data: Buffer) : void {
        log.debug(`Got reply to message ${this._id} containing ${data.byteLength} bytes of data`)
        log.trace('reply', data)
        this._stopTimer()
        this._state = MessageState.REPLY
        this._reply = data
        this._replyCallback(data)
    }

    public error() : void {
        log.debug(`Message ${this._id} went into an error state`)
        this._stopTimer()
        this._state = MessageState.ERROR
    }
}
class ReceivedMessage {
    private _id : UUID
    private _state: MessageState
    private _lastModified: Date
    private _reply?: SentMessage
    private _error?: Error
    constructor(id: UUID) {
        this._id = id
        this._state = MessageState.RECEIVED
        this._lastModified = new Date()
    }
    public get id() : UUID {
        return this._id
    }
    public get state() : MessageState {
        return this._state
    }    
    public get replyMessage() : SentMessage | undefined {
        return this._reply
    }
    public get error() : Error | undefined {
        return this._error
    }
    public get lastModified() : Date {
        return this._lastModified
    }    
    public ack() : void {
        this._state = MessageState.ACK
        this._lastModified = new Date()
    }
    public nak() : void {
        this._state = MessageState.NAK
        this._lastModified = new Date()
    }
    public reply(message: SentMessage) : void {
        this._state = MessageState.REPLY
        this._lastModified = new Date()
        this._reply = message
    }

    public logError(error: Error) : void {
        this._state = MessageState.REPLY
        this._lastModified = new Date()
        this._error = error

    }
}
export type MessageHandler = (data: Buffer, respond:(reply?: Promise<Buffer> | Buffer) => Promise<void>) => void
export type ErrorHandler = (error: Error) => void
type ResolveCallback = (value?: void | PromiseLike<void> | undefined) => void
type RejectCallback = (error?: Error) => void
export interface SocketConfig {
    id: string
    socketOrPath: Socket | string
    messageHandler?: MessageHandler
    errorHandler?: ErrorHandler
}

export class IpcSocket {
    
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
    constructor(options: SocketConfig, protocolOptions: ProtocolConfig) {

        this._id = options.id
        this._sentMessages = new Map<string, SentMessage>()
        this._sentRequests = new Map<string, SentMessage>()
        this._sentReplies = new Map<string, SentMessage>()
        this._receivedMessages = new Map<string, ReceivedMessage>()

        if(options.socketOrPath instanceof Socket) {
            this._socket = options.socketOrPath
        } else {
            this._socket = new Socket()
        }

        this._config = protocolOptions

        this._socket.on('close', this._Socket_onClose.bind(this))
        this._socket.on('connect', this._Socket_onConnect.bind(this))
        this._socket.on('data', this._Socket_onData.bind(this))
        this._socket.on('drain', this._Socket_onDrain.bind(this))
        this._socket.on('end', this._Socket_onEnd.bind(this))
        this._socket.on('error', this._Socket_onError.bind(this))
        this._socket.on('lookup', this._Socket_onLookup.bind(this))
        this._socket.on('timeout', this._Socket_onTimeout.bind(this))

        this._reader = new MessageReader({
            messageHandler: this._Reader_onMessage.bind(this),
            messageQueryHandler: this._Reader_onMessageQuery.bind(this),
            replyHandler: this._Reader_onReply.bind(this),
            replyQueryHandler: this._Reader_onReplyQuery.bind(this),
            ackHandler: this._Reader_onAck.bind(this),
            nakHandler: this._Reader_onNak.bind(this)
        })

        this._writer = new MessageWriter({
            bufferSize: 1024
        })

        this._messageHandler = options.messageHandler
        this._errorHandler = options.errorHandler

        if(!(options.socketOrPath instanceof Socket)) {
            log.debug(`Connecting to ${options.socketOrPath}...`)
            this._socket.connect(options.socketOrPath)
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
            const message = new SentMessage(id, data, MessageType.MESSAGE, 
                this._config, ()=>{}, ack, nak, this._retry.bind(this, id, data))
            this._sentMessages.set(message.id+'', message)
            this._writer.writeMessage(message.id, data)
            this._socket.write(this._writer.flush(), message.sent.bind(message))            
        })
    }
    public sendRequest(data: Buffer, ack: () => void) : Promise<Buffer> {
        return new Promise<Buffer>((respond, nak) => {
            const id = new UUID()
            const request = new SentMessage(id, data, MessageType.REQUEST, this._config, 
                respond, ack, nak, this._retry.bind(this, id, data))
            this._sentRequests.set(request.id+'', request)
            this._writer.writeMessage(request.id, data)
            this._socket.write(this._writer.flush(), request.sent.bind(request))                
        })
    }
    private _createAndSendReply(id: UUID, data: Buffer, ack: ResolveCallback, nak: RejectCallback, message: ReceivedMessage) {
        const replyMessage = new SentMessage(id, data, MessageType.REPLY, this._config, 
            ()=>{}, ack, nak, this._retry.bind(this, id, data, true));
        this._sentReplies.set(id+'', replyMessage);
        this._sendReply(id, data, message.reply.bind(message, replyMessage));
    }
    private _retry(id: UUID, data: Buffer, isReply: boolean = false) {
        const writer = (isReply) ? 
            (this._config.retryWithQuery) ? 
                this._writer.writeReplyQuery.bind(this._writer) : 
                this._writer.writeReply.bind(this._writer) :
            (this._config.retryWithQuery) ? 
                this._writer.writeMessageQuery.bind(this._writer) : 
                this._writer.writeMessage.bind(this._writer)
        writer(id, data)
        this._socket.write(this._writer.flush())
    }
    private _sendReply(id: UUID, data: Buffer, sent?: ResolveCallback) : void {
        this._writer.writeReply(id, data)
        this._socket.write(this._writer.flush(), sent)
    }
    private _sendAck(id: UUID, sent?: ResolveCallback) : void{
            this._writer.writeAck(id)
            this._socket.write(this._writer.flush(), sent)    
    }

    private _sendNak(id: UUID, sent?: ResolveCallback){
            this._writer.writeNak(id)
            this._socket.write(this._writer.flush(), sent)  
    }
    private _resendResponse(prevMessage: ReceivedMessage) {
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
                this._sendReply(prevMessage.id, prevMessage.replyMessage!.data);
                break;
        }
    }

    private _callMessageHandler(data: Buffer, respond: (reply: Promise<Buffer> | Buffer | void) => Promise<void>) : void {
        if(this._messageHandler) {
            this._messageHandler(data, respond)
        } else {
            log.error(`Incoming message discarded. No handler listening.`)
            throw new Error("No message handler listening.")
        }
    }

    private _callErrorHandler(error: Error) : void {
        log.error(error)
        if(this._errorHandler) {
            this._errorHandler(error)
        }         
    }

    private _Socket_onClose(hadError: boolean): void {
        log.info(`Socket ${this._id} closed with ${hadError ? '' : ' no'} errors`)        
    }
    private _Socket_onConnect(): void {
        log.debug(`Socket ${this._id} Connected`)

    }
    private _Socket_onData(data: Buffer): void {
        log.debug(`Socket ${this._id} received ${data.byteLength} bytes of data`)
        log.trace('data received', data)
        this._reader.read(data)
    }
    private _Reader_onMessage(id: UUID, data: Buffer) : void {
        log.debug(`Got message ${id} containing ${data.byteLength} bytes of data`)
        log.trace('message', id, data)
        
        // Idempotency - resend old reply or ack
        const prevMessage = this._receivedMessages.get(id+'')
        if(prevMessage) {
            this._resendResponse(prevMessage);
        } else {
            const receivedMessage = new ReceivedMessage(id)
            this._receivedMessages.set(id+'', receivedMessage)
            try {
                this._callMessageHandler(data, (reply: void | Buffer | Promise<Buffer> ) => {
                    return new Promise<void>((replyAck, replyNak) => {
                            if(reply) {
                                if(reply instanceof Promise) {
                                    // We got a promise so send an ACK first
                                    this._sendAck(id, receivedMessage.ack.bind(receivedMessage))
                                    reply.then(asyncReply => {
                                        // Now send the reply
                                        this._createAndSendReply(id, asyncReply, replyAck, replyNak, receivedMessage);
                                    }).catch((error) => {
                                        log.error(`Message handler threw an error handling message ${id} after sending ACK`, error)
                                        this._sendNak(id, receivedMessage.nak.bind(receivedMessage))
                                    })
                                } else {
                                    this._createAndSendReply(id, reply, replyAck, replyNak, receivedMessage);
                                }  
                            } else {
                                this._sendAck(id)
                            }
                    })
                })
            } catch (e) {
                log.error(`Error processing incoming message ${id}.`, e)
                receivedMessage.logError(e);            
                this._sendNak(id)
            }    
        }
    }
    private _Reader_onMessageQuery(id: UUID) : void {
        log.debug(`Got message query ${id}`)
        log.trace('message query', id)
        const prevMessage = this._receivedMessages.get(id+'')
        if(prevMessage) {
            this._resendResponse(prevMessage);
        } else {
            this._sendNak(id)
        }
    }
    private _Reader_onReply(id: UUID, data: Buffer) : void {
        const request = this._sentRequests.get(id+'')
        if(request) {
            request.replyWith(data)
            this._sendAck(id)
        } else {
            console.log(request)
            //Unsolicited reply
            if(this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited reply ${id} received.`))
            }
            this._sendNak(id)
        }
    }
    private _Reader_onReplyQuery(id: UUID) : void {
        log.debug(`Got reply query ${id}`)
        log.trace('reply query', id)
        const request = this._sentRequests.get(id+'')
        if(request && request.reply) {
            this._sendAck(id)
        } else {
            console.log(request)
            //Unsolicited reply
            if(this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited reply ${id} received.`))
            }
            this._sendNak(id)
        }
    }
    private _Reader_onAck(id: UUID) : void {
        const id_string = id.toString()
        const message = 
            this._sentMessages.get(id_string) ||
            this._sentReplies.get(id_string) ||
            this._sentRequests.get(id_string)
        if(message) {
            message.ack()
        } else {
            console.log(message)
            //Unsolicited ACK
            if(this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited ACK ${id} received.`))
            }
        }
    }
    private _Reader_onNak(id: UUID) : void {
        const id_string = id.toString()
        const message = 
            this._sentMessages.get(id_string) ||
            this._sentReplies.get(id_string) ||
            this._sentRequests.get(id_string)
        if(message) {
            message.nak()
        } else {
            console.log(message)
            //Unsolicited NAK
            if(this._config.throwOnUnsolictedResponse) {
                this._callErrorHandler(new Error(`Unsolicited ACK ${id} received.`))
            }
        }
    }
    private _Socket_onDrain() {
        log.debug(`Socket ${this._id} output buffer drained`)
    }
    private _Socket_onEnd() {
        log.debug(`Socket ${this._id} end`)
    }
    private _Socket_onError(error: Error) {
        log.error(`Socket ${this._id} error`, error)
        // TODO Close socket
    }
    private _Socket_onLookup() {
        // No-op
    }
    private _Socket_onTimeout() {
        log.debug(`Socket ${this._id} timeout`)        
    }
}