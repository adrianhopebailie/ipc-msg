import * as assert from 'assert'
import { randomBytes } from 'crypto'

export default class UUID {
    private _buffer: Buffer
    constructor(uuid?: Buffer) {
        assert(uuid ? uuid.length === 16 : true, 'UUID must be exactly 16 bytes')
        this._buffer = uuid ? uuid : randomBytes(16)
    }
    public get bytes(): Buffer {
        return this._buffer as Buffer
    }
    public toString(): string {
        return (
            this._buffer.toString('hex', 0, 4) +
            '-' +
            this._buffer.toString('hex', 4, 6) +
            '-' +
            this._buffer.toString('hex', 6, 8) +
            '-' +
            this._buffer.toString('hex', 8, 10) +
            '-' +
            this._buffer.toString('hex', 10, 16)
        )
    }
}
