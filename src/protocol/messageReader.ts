import { ACK, EOT, ETX, NAK, SOH, STX, UUID } from '.'
import { create as createLogger } from '../log'

export interface IMessageReaderOptions {
    bufferSize: number
}

export interface IMessageReaderHandlers {
    messageHandler?: (id: UUID, data: Buffer) => void
    replyHandler?: (id: UUID, data: Buffer) => void
    messageQueryHandler?: (id: UUID) => void
    replyQueryHandler?: (id: UUID) => void
    ackHandler?: (id: UUID) => void
    nakHandler?: (id: UUID) => void
    errorHandler?: (errorData: Buffer) => void
}

enum MessageReaderState {
    SOH,
    UUID,
    STX,
    LENGTH_OF_LENGTH,
    LENGTH,
    MESSAGE,
    ERROR,
}

export default class MessageReader {
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
    private _messageHandler: (id: UUID, data: Buffer) => void
    private _replyHandler: (id: UUID, data: Buffer) => void
    private _messageQueryHandler: (id: UUID) => void
    private _replyQueryHandler: (id: UUID) => void
    private _ackHandler: (id: UUID) => void
    private _nakHandler: (id: UUID) => void
    private _errorHandler: (badData: Buffer) => void
    private _log = createLogger('ipc-reader')
    constructor(handlers: IMessageReaderHandlers, options?: IMessageReaderOptions) {
        this._messageHandler =
            handlers.messageHandler ||
            (() => {
                /* NOOP */
            })
        this._replyHandler =
            handlers.replyHandler ||
            (() => {
                /* NOOP */
            })
        this._messageQueryHandler =
            handlers.messageQueryHandler ||
            (() => {
                /* NOOP */
            })
        this._replyQueryHandler =
            handlers.replyQueryHandler ||
            (() => {
                /* NOOP */
            })
        this._ackHandler =
            handlers.ackHandler ||
            (() => {
                /* NOOP */
            })
        this._nakHandler =
            handlers.nakHandler ||
            (() => {
                /* NOOP */
            })
        this._errorHandler =
            handlers.errorHandler ||
            (() => {
                /* NOOP */
            })
        if (options) {
            this._messageBuffer = Buffer.allocUnsafe(options.bufferSize)
        } else {
            this._messageBuffer = Buffer.allocUnsafe(1024 * 1024)
        }
        this._log.debug(`Created new message reader with buffer size of ${this._messageBuffer.length}`)
    }
    public read(data: Buffer) {
        this._log.debug(`Reading in ${data.length} bytes of data. Current state is ${this._state}`)
        this._readStart = 0
        this._possibleReadStart = 0
        for (let i = 0; i < data.length; i++) {
            switch (this._state) {
                case MessageReaderState.SOH:
                    if (data[i] !== SOH) {
                        this._state = MessageReaderState.ERROR
                        break
                    }
                    this._readStart = i
                    this._uuidBytesRead = 0
                    this._state = MessageReaderState.UUID
                    break
                case MessageReaderState.UUID:
                    this._uuidBuffer[this._uuidBytesRead++] = data[i]
                    if (this._uuidBytesRead === 16) {
                        this._log.debug(`Read UUID: ${this._uuidBuffer}`)
                        this._state = MessageReaderState.STX
                        break
                    }
                    break
                case MessageReaderState.STX:
                    if (data[i] !== STX) {
                        if (data[i] === ACK) {
                            this._ack()
                            break
                        }
                        if (data[i] === NAK) {
                            this._nak()
                            break
                        }
                        this._state = MessageReaderState.ERROR
                        break
                    }
                    this._state = MessageReaderState.LENGTH_OF_LENGTH
                    break
                case MessageReaderState.LENGTH_OF_LENGTH:
                    if (data[i] < 128) {
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
                    if (this._lengthOfLength > 4) {
                        this._state = MessageReaderState.ERROR
                    } else {
                        this._log.debug(`Read Length of Length: ${this._lengthOfLength}`)
                        this._state = MessageReaderState.LENGTH
                    }
                    break
                case MessageReaderState.LENGTH:
                    this._length = this._length << (8 + data[i])
                    this._lengthBytesRead++
                    if (this._lengthBytesRead === this._lengthOfLength) {
                        // Increase buffer to accommodate message size (max is Int32.MAX)
                        if (this._length > this._messageBuffer.length) {
                            this._messageBuffer = Buffer.allocUnsafe(this._length)
                        }
                        this._log.debug(`Read Length: ${this._length}`)
                        this._messageBytesRead = 0
                        this._state = MessageReaderState.MESSAGE
                    }
                    break
                case MessageReaderState.MESSAGE:
                    if (this._messageBytesRead === this._length) {
                        switch (data[i]) {
                            case ETX:
                                this._length > 0 ? this._message() : this._messageQuery()
                                break
                            case EOT:
                                this._length > 0 ? this._reply() : this._replyQuery()
                                break
                            default:
                                this._state = MessageReaderState.ERROR
                        }
                    }
                    this._messageBuffer[this._messageBytesRead++] = data[i]
                    break
                case MessageReaderState.ERROR:
                    if (this._readStart < this._possibleReadStart) {
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
            if (data[i] === SOH && this._lastValueWasEndChar && this._possibleReadStart === this._readStart) {
                this._possibleReadStart = i
            }
            this._lastValueWasEndChar = data[i] === ACK || data[i] === NAK || data[i] === EOT || data[i] === EOT
        }
        // End of buffer and we're in an error state
        if (this._state === MessageReaderState.ERROR) {
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
        this._messageHandler(new UUID(this._uuidBuffer), this._messageBuffer.slice(0, this._length))
    }
    private _messageQuery() {
        this._log.debug(`Read message query`)
        this._state = MessageReaderState.SOH
        this._messageQueryHandler(new UUID(this._uuidBuffer))
    }
    private _reply() {
        this._log.debug(`Read reply`)
        this._state = MessageReaderState.SOH
        this._replyHandler(new UUID(this._uuidBuffer), this._messageBuffer.slice(0, this._length))
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
