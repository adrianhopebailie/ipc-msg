import { randomBytes } from 'crypto'
import * as assert from 'assert'
import { create as createLogger } from './log'

const SOH = 0x01
const STX = 0x02
const ETX = 0x03
const EOT = 0x04
const ACK = 0x06
const NAK = 0x15

export class UUID {
    private _buffer : Buffer
    constructor(uuid?: Buffer) {
        this._buffer = uuid ? uuid : randomBytes(16)
    }
    public get bytes() : Buffer {
        return this._buffer as Buffer
    }
    public toString() : string {
        return this._buffer.toString('hex', 0, 4) + '-' +
            this._buffer.toString('hex', 4, 6) + '-' +
            this._buffer.toString('hex', 6, 8) + '-' +
            this._buffer.toString('hex', 8, 10) + '-' +
            this._buffer.toString('hex', 10, 16)
        }
}

export interface MessageReaderHandlers {
    messageHandler?: (id: UUID, data: Buffer) =>  void
    replyHandler?: (id: UUID, data: Buffer) =>  void
    messageQueryHandler?: (id: UUID) =>  void
    replyQueryHandler?: (id: UUID) =>  void
    ackHandler?: (id: UUID) =>  void
    nakHandler?: (id: UUID) =>  void
    errorHandler?: (errorData: Buffer) => void
}

export interface MessageReaderOptions {
    bufferSize: number
}

export interface MessageWriterOptions {
    bufferSize: number
}

enum MessageReaderState { SOH, UUID, STX, LENGTH_OF_LENGTH, LENGTH, MESSAGE, ERROR }

export class MessageReader {

    private _state = MessageReaderState.SOH
    private _readStart = 0
    private _possibleReadStart = 0
    private _lastValueWasEndChar = true
    private _uuidBuffer = Buffer.allocUnsafe(16)
    private _uuidBytesRead = 0
    private _lengthOfLength = 0
    private _length = 0
    private _lengthBytesRead = 0
    private _messageBuffer: Buffer
    private _messageBytesRead = 0
    private _messageHandler: (id: UUID, data: Buffer) =>  void
    private _replyHandler: (id: UUID, data: Buffer) =>  void
    private _messageQueryHandler: (id: UUID) =>  void
    private _replyQueryHandler: (id: UUID) =>  void
    private _ackHandler: (id: UUID) =>  void
    private _nakHandler: (id: UUID) =>  void
    private _errorHandler: (badData: Buffer) => void
    private _log = createLogger('ipc-reader')

    constructor(handlers: MessageReaderHandlers, options?: MessageReaderOptions) {
        this._messageHandler = handlers.messageHandler || (() => {})
        this._replyHandler = handlers.replyHandler || (() => {})
        this._messageQueryHandler = handlers.messageQueryHandler || (() => {})
        this._replyQueryHandler = handlers.replyQueryHandler || (() => {})
        this._ackHandler = handlers.ackHandler || (() => {})
        this._nakHandler = handlers.nakHandler || (() => {})
        this._errorHandler = handlers.errorHandler || (() => {})

        if(options) {
            this._messageBuffer = Buffer.allocUnsafe(options.bufferSize)
        } else {
            this._messageBuffer = Buffer.allocUnsafe(1024 * 1024)
        }

        this._log.debug(`Created new message reader with buffer size of ${this._messageBuffer.length}`, )
    }

    public read(data: Buffer) {

        this._log.debug(`Reading in ${data.length} bytes of data. Current state is ${this._state}`)

        this._readStart = 0
        this._possibleReadStart = 0

        for(let i = 0; i < data.length; i++) {            
            switch(this._state) {
                case MessageReaderState.SOH:
                    if(data[i] != SOH) {
                        this._state = MessageReaderState.ERROR
                        break
                    }
                    this._readStart = i
                    this._uuidBytesRead = 0
                    this._state = MessageReaderState.UUID
                break

                case MessageReaderState.UUID:
                    this._uuidBuffer[this._uuidBytesRead++] = data[i]
                    if(this._uuidBytesRead === 16) {
                        this._log.debug(`Read UUID: ${this._uuidBuffer}`)
                        this._state = MessageReaderState.STX
                        break
                    }
                break

                case MessageReaderState.STX:
                    if(data[i] != STX) {
                        if(data[i] == ACK) {
                            this._ack()
                            break
                        }
                        if(data[i] == NAK) {
                            this._nak()
                            break
                        }
                        this._state = MessageReaderState.ERROR
                        break
                    }
                    this._state = MessageReaderState.LENGTH_OF_LENGTH
                break

                case MessageReaderState.LENGTH_OF_LENGTH:
                    if(data[i] < 128) {
                        this._length = data[i]
                        this._lengthOfLength = 0
                        this._messageBytesRead = 0
                        this._state = MessageReaderState.MESSAGE
                        this._log.debug(`Read Length: ${this._length}`)
                        break
                    }
                    this._length = 0
                    this._lengthBytesRead = 0
                    this._lengthOfLength = data[i] - 128
                    if(this._lengthOfLength > 4) {
                        this._state = MessageReaderState.ERROR
                    } else {
                        this._log.debug(`Read Length of Length: ${this._lengthOfLength}`)
                        this._state = MessageReaderState.LENGTH

                    }
                break

                case MessageReaderState.LENGTH:
                    this._length = this._length << 8 + data[i]
                    this._lengthBytesRead++
                    if(this._lengthBytesRead === this._lengthOfLength) {
                        //Increase buffer to accommodate message size (max is Int32.MAX)
                        if(this._length > this._messageBuffer.length) {
                            this._messageBuffer = Buffer.allocUnsafe(this._length)
                        }
                        this._log.debug(`Read Length: ${this._length}`)
                        this._messageBytesRead = 0
                        this._state = MessageReaderState.MESSAGE             
                    }
                break

                case MessageReaderState.MESSAGE:
                    if(this._messageBytesRead === this._length){
                        switch(data[i]) {
                            case ETX:
                                (this._length > 0) ? this._message() : this._messageQuery()
                                break
                            case EOT:
                                (this._length > 0) ? this._reply() : this._replyQuery()
                                break
                            default:
                                this._state = MessageReaderState.ERROR
                        }
                    }
                    this._messageBuffer[this._messageBytesRead++] = data[i]
                break

                case MessageReaderState.ERROR:
                    if(this._readStart < this._possibleReadStart) {
                        // There was a possible frame start along the way. 
                        // Throw away everything up to that point and restart
                        this._throw(data.slice(this._readStart, this._possibleReadStart))
                        i = this._possibleReadStart
                        this._state = MessageReaderState.SOH
                    }

                    // TODO - Handle some edge cases
                    // 1. Part of meesage read from previous buffer
                    // 2. Part of message read + possible frame boundary encountered from previous buffer  

                break
            }

            // Record where we see a possible frame boundry
            // If we discover this message is corrupt we can go back and try to start again from here
            if(data[i] == SOH && this._lastValueWasEndChar && this._possibleReadStart === this._readStart) {
                this._possibleReadStart = i
            }
            
            this._lastValueWasEndChar = (data[i] === ACK || data[i] === NAK || data[i] === EOT || data[i] === EOT )
        }

        // End of buffer and we're in an error state
        if(this._state === MessageReaderState.ERROR) {
            // Throw away everything since last start and reset. 
            // If the corrupt message continues on next read then we'll pick that up and go back into error state
            this._throw(data.slice(this._readStart, data.length))
            this._state = MessageReaderState.SOH
            this._log.error(`Discarded ${data.length - this._readStart} bytes of bad data.`)
        } 

        this._log.debug(`Finished reading. Current state is ${this._state}`)
    }
    private _ack() {
        this._log.debug(`Read ACK`)
        this._state = MessageReaderState.SOH
        this._ackHandler(new UUID(this._uuidBuffer))        
    }
    private _nak() {
        this._log.debug(`Read NAK`)
        this._state = MessageReaderState.SOH
        this._nakHandler(new UUID(this._uuidBuffer))        
    }
    private _message() {   
        this._log.debug(`Read message`)
        this._state = MessageReaderState.SOH
        this._messageHandler(new UUID(this._uuidBuffer), this._messageBuffer.slice(0,this._length))
    }
    private _messageQuery() {
        this._log.debug(`Read message query`)
        this._state = MessageReaderState.SOH
        this._messageQueryHandler(new UUID(this._uuidBuffer))        
    }
    private _reply() {
        this._log.debug(`Read reply`)
        this._state = MessageReaderState.SOH
        this._replyHandler(new UUID(this._uuidBuffer), this._messageBuffer.slice(0,this._length))
    }
    private _replyQuery() {
        this._log.debug(`Read reply query`)
        this._state = MessageReaderState.SOH
        this._replyQueryHandler(new UUID(this._uuidBuffer))        
    }
    private _throw(badData: Buffer) {
        this._log.debug(`Threw away ${badData.length} of unreadable data`)
        this._state = MessageReaderState.SOH
        this._errorHandler(badData)
    }
}

export class MessageWriter {

    private _buffer: Buffer
    private _bufferPos = 0
    private _emptyBuffer = Buffer.allocUnsafe(0)
    private _log = createLogger('ipc-writer')

    constructor(options?: MessageWriterOptions) {
        if(options) {
            this._buffer = Buffer.allocUnsafe(options.bufferSize)
        } else {
            this._buffer = Buffer.allocUnsafe(1024)
        }
        this._log.debug(`Created new writer with buffer size of ${this._buffer.length}`)
    }

    public writeMessage(id: UUID, message: Buffer): number {
        this._log.debug(`Writing ${message.length} byte message to buffer`)
        this._write(id, message, ETX)
        return this._bufferPos
    }

    public writeMessageQuery(id: UUID): number {
        this._log.debug(`Writing message query to buffer`)
        this._write(id, this._emptyBuffer, ETX)
        return this._bufferPos
    }

    public writeReply(id: UUID, message: Buffer): number {
        this._log.debug(`Writing ${message.length} byte reply to buffer`)
        this._write(id, message, EOT)
        return this._bufferPos
    }

    public writeReplyQuery(id: UUID): number {
        this._log.debug(`Writing reply query to buffer`)
        this._write(id, this._emptyBuffer, EOT)
        return this._bufferPos
    }

    public writeAck(id: UUID): number {
        this._log.debug(`Writing ack to buffer`)
        this._write(id, this._emptyBuffer, ACK)
        return this._bufferPos
    }

    public writeNak(id: UUID): number {
        this._log.debug(`Writing nak to buffer`)
        this._write(id, this._emptyBuffer, NAK)
        return this._bufferPos
    }

    public flush() : Buffer {
        const length = this._bufferPos
        this._bufferPos = 0
        this._log.debug(`Flushing ${length} bytes from write buffer`)
        return this._buffer.slice(0, length)
    }

    private _write(id: UUID, message: Buffer, terminator: number) : void {
        
        assert([ETX,EOT,ACK,NAK].includes(terminator), "Invalid message terminator")
        assert(message.length <= 0xFFFFFFFF, "Message exceeds maximum length of UInt32.MAX.")
        
        const requiredBufferSpace = (terminator === ETX || terminator === EOT && message.length > 0) ? 
            message.length + 24 : 
            18
        if(this._buffer.length - this._bufferPos < requiredBufferSpace) {
            throw new Error("Exceeded available space in write buffer.")
        }

        this._buffer.writeUInt8(SOH, this._bufferPos++)
        this._bufferPos += id.bytes.copy(this._buffer, this._bufferPos, 0)

        if(terminator === ETX || terminator === EOT) {
            this._buffer.writeUInt8(STX, this._bufferPos++)
            if(message.length > 0x7F) {

                const lengthOfLength = 
                    (message.length <= 0xFF) ? 1 :
                    ((message.length <= 0xFFFF) ? 2 :
                    (((message.length <= 0xFFFFFF) ? 3 : 4)))
                
                this._buffer.writeUInt8(lengthOfLength, this._bufferPos++)
                for(let i = lengthOfLength - 1; i >= 0; i--) {
                    this._buffer.writeUInt8(message.length >> (8 * i), this._bufferPos++)
                }
            } else {
                this._buffer.writeUInt8(message.length, this._bufferPos++)
            }

            if(message.length > 0) {
                message.copy(this._buffer, this._bufferPos, 0)
                this._bufferPos += message.length
            }
        }

        this._buffer.writeUInt8(terminator, this._bufferPos++)
    }
    
}

export interface Config {
    ackTimeoutMs: number
    replyTimeoutMs: number
    throwOnUnsolictedResponse: boolean
    retryWithQuery: boolean
    maxRetries: number
}

export class DefaultConfig implements Config {

    constructor(custom?: {
        ackTimeoutMs?: number
        replyTimeoutMs?: number
        throwOnUnsolictedResponse?: boolean
        retryWithQuery?: boolean
        maxRetries?: number        
    }) {
        this.ackTimeoutMs = (custom && custom.ackTimeoutMs) ? 
            custom.ackTimeoutMs : 
            this.ackTimeoutMs
        this.replyTimeoutMs = (custom && custom.replyTimeoutMs) ? 
            custom.replyTimeoutMs : 
            this.replyTimeoutMs
        this.throwOnUnsolictedResponse = (custom && custom.throwOnUnsolictedResponse) ?
            custom.throwOnUnsolictedResponse :
            this.throwOnUnsolictedResponse
        this.retryWithQuery = (custom && custom.retryWithQuery) ?
            custom.retryWithQuery :
            this.retryWithQuery
        this.maxRetries = (custom && custom.maxRetries) ?
            custom.maxRetries :
            this.maxRetries
    }
    ackTimeoutMs = 1000
    replyTimeoutMs = 5000
    throwOnUnsolictedResponse = true
    retryWithQuery = false
    maxRetries = Infinity
}