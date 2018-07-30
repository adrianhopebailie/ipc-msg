export const SOH = 0x01
export const STX = 0x02
export const ETX = 0x03
export const EOT = 0x04
export const ACK = 0x06
export const NAK = 0x15

export interface ProtocolConfig {
    ackTimeoutMs: number
    replyTimeoutMs: number
    throwOnUnsolictedResponse: boolean
    retryWithQuery: boolean
    maxRetries: number
}

export class DefaultConfig implements ProtocolConfig {
    public ackTimeoutMs = 5000
    public replyTimeoutMs = 15000
    public throwOnUnsolictedResponse = true
    public retryWithQuery = false
    public maxRetries = Infinity

    constructor(custom?: {
        ackTimeoutMs?: number
        replyTimeoutMs?: number
        throwOnUnsolictedResponse?: boolean
        retryWithQuery?: boolean
        maxRetries?: number
    }) {
        this.ackTimeoutMs = custom && custom.ackTimeoutMs ? custom.ackTimeoutMs : this.ackTimeoutMs
        this.replyTimeoutMs = custom && custom.replyTimeoutMs ? custom.replyTimeoutMs : this.replyTimeoutMs
        this.throwOnUnsolictedResponse =
            custom && custom.throwOnUnsolictedResponse
                ? custom.throwOnUnsolictedResponse
                : this.throwOnUnsolictedResponse
        this.retryWithQuery = custom && custom.retryWithQuery ? custom.retryWithQuery : this.retryWithQuery
        this.maxRetries = custom && custom.maxRetries ? custom.maxRetries : this.maxRetries
    }
}

export { default as UUID } from './uuid'
export { default as MessageReader } from './messageReader'
export { default as MessageWriter } from './messageWriter'
