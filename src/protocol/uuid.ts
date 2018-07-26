import * as assert from 'assert'
import { randomBytes } from 'crypto'


const v4BitFlag = 0x40 // 0100 0000
const v4BitMask = 0x4F // 0100 1111
const v4TestMask = 0xF0 // 1111 0000

const variant1Flag = 0x80 // 1000 0000
const variant1Mask = 0xBF // 1011 1111
const variant1TestMask = 0xC0 // 1100 0000

export default class UUID {
    private _buffer: Buffer
    constructor(uuid?: Buffer) {
        this._buffer = Buffer.allocUnsafe(16)
        if(uuid) {
            assert(uuid.length === 16, 'UUID must be exactly 16 bytes')
            assert((uuid[6] & v4TestMask) === v4BitFlag , 'Only v4 UUIDs accepted')
            assert((uuid[8] & variant1TestMask) === variant1Flag , 'Only variant 1 UUIDs accepted')
            uuid.copy(this._buffer, 0, 0)
        } else {
            randomBytes(16).copy(this._buffer, 0, 0)
            // Set version bits
            this._buffer[6] = (this._buffer[6] | v4BitFlag) & v4BitMask
            // Set variant bits
            this._buffer[8] = (this._buffer[8] | variant1Flag) & variant1Mask 
        }
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
