import { ProtocolConfig, UUID } from '../protocol'
import { MessageState, MessageType } from './ipcSocket'

export default class SentMessage {
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

    constructor(
        id: UUID,
        data: Buffer,
        type: MessageType,
        config: ProtocolConfig,
        replyCallback: (reply: Buffer) => void,
        ackCallback: () => void,
        nakCallback: () => void,
        retryCallback: () => void,
    ) {
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

    public get id(): UUID {
        return this._id
    }
    public get type(): MessageType {
        return this._type
    }

    public get data(): Buffer {
        return this._data
    }

    public get reply(): Buffer | undefined {
        return this._reply
    }

    public get retries(): number {
        return this._retries - 1
    }

    public get isComplete(): boolean {
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

    public get lastModified(): Date {
        return this._lastModified
    }

    public sent(): void {
        this._state = MessageState.SENT
        this._startTimer()
    }

    public ack(): void {
        this._stopTimer()
        switch (this._state) {
            case MessageState.SENT:
                this._state = MessageState.ACK
                this._ackCallback()
                if (this._type === MessageType.REQUEST) {
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
    public nak(): void {
        this._stopTimer()
        switch (this._state) {
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
        }
    }
    public replyWith(data: Buffer): void {
        this._stopTimer()
        this._state = MessageState.REPLY
        this._reply = data
        this._replyCallback(data)
    }
    private _startTimer() {
        const interval = this._state === MessageState.ACK ? this._config.replyTimeoutMs : this._config.ackTimeoutMs
        this._timer = setTimeout(() => {
            if (this._retries <= this._config.maxRetries) {
                this._retryCallback()
                this._retries++
                this._startTimer()
            } else {
                this._state = MessageState.TIMED_OUT
            }
        }, interval)
    }
    private _stopTimer() {
        if (this._timer) {
            clearTimeout(this._timer!)
        }
    }
}
