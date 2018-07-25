import * as assert from 'assert'
import { ACK, EOT, ETX, NAK, SOH, STX, UUID } from '.'
import { create as createLogger } from '../log'

export interface IMessageWriterOptions {
    bufferSize: number
}
export default class MessageWriter {
    private _buffer: Buffer
    private _bufferPos = 0
    private _emptyBuffer = Buffer.allocUnsafe(0)
    private _log = createLogger('ipc-writer')
    constructor(options?: IMessageWriterOptions) {
        if (options) {
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
    public flush(): Buffer {
        const length = this._bufferPos
        this._bufferPos = 0
        this._log.debug(`Flushing ${length} bytes from write buffer`)
        return this._buffer.slice(0, length)
    }
    private _write(id: UUID, message: Buffer, terminator: number): void {
        assert([ETX, EOT, ACK, NAK].includes(terminator), 'Invalid message terminator')
        assert(message.length <= 0xffffffff, 'Message exceeds maximum length of UInt32.MAX.')
        const requiredBufferSpace =
            terminator === ETX || (terminator === EOT && message.length > 0) ? message.length + 24 : 18
        if (this._buffer.length - this._bufferPos < requiredBufferSpace) {
            throw new Error('Exceeded available space in write buffer.')
        }
        this._buffer.writeUInt8(SOH, this._bufferPos++)
        this._bufferPos += id.bytes.copy(this._buffer, this._bufferPos, 0)
        if (terminator === ETX || terminator === EOT) {
            this._buffer.writeUInt8(STX, this._bufferPos++)
            if (message.length > 0x7f) {
                const lengthOfLength =
                    message.length <= 0xff ? 1 : message.length <= 0xffff ? 2 : message.length <= 0xffffff ? 3 : 4
                this._buffer.writeUInt8(lengthOfLength, this._bufferPos++)
                for (let i = lengthOfLength - 1; i >= 0; i--) {
                    this._buffer.writeUInt8(message.length >> (8 * i), this._bufferPos++)
                }
            } else {
                this._buffer.writeUInt8(message.length, this._bufferPos++)
            }
            if (message.length > 0) {
                message.copy(this._buffer, this._bufferPos, 0)
                this._bufferPos += message.length
            }
        }
        this._buffer.writeUInt8(terminator, this._bufferPos++)
    }
}
