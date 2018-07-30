import { CachedMessage } from '.'
import { UUID } from '../protocol'
import { MessageState } from './ipcSocket'
import SentMessage from './sentMessage'

export default class ReceivedMessage implements CachedMessage {
    private _id: UUID
    private _state: MessageState
    private _lastModified: number
    private _reply?: SentMessage
    private _error?: Error
    constructor(id: UUID) {
        this._id = id
        this._state = MessageState.RECEIVED
        this._lastModified = Date.now()
    }
    public get id(): UUID {
        return this._id
    }
    public get state(): MessageState {
        return this._state
    }
    public get replyMessage(): SentMessage | undefined {
        return this._reply
    }
    public get error(): Error | undefined {
        return this._error
    }
    public get lastModified(): number {
        return this._lastModified
    }
    public ack(): void {
        this._state = MessageState.ACK
        this._lastModified = Date.now()
    }
    public nak(): void {
        this._state = MessageState.NAK
        this._lastModified = Date.now()
    }
    public reply(message: SentMessage): void {
        this._state = MessageState.REPLY
        this._lastModified = Date.now()
        this._reply = message
    }

    public logError(error: Error): void {
        this._state = MessageState.REPLY
        this._lastModified = Date.now()
        this._error = error
    }
}
