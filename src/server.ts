import { Server, Socket } from 'net'
import { IpcSocket } from './socket'
import { Config as ProtocolConfig, UUID } from './protocol'
import { create as createLogger } from './log'
const log = createLogger('ipc-server')

interface ServerConfig {
    allowHalfOpen?: boolean
    pauseOnConnect?: boolean
    messageHandler: MessageHandler
    errorHandler: ErrorHandler
}

export type MessageHandler = (client: IpcSocket, data: Buffer, response: (reply?: Buffer | Promise<Buffer>) => Promise<void>) => void
export type ErrorHandler = (client: IpcSocket | undefined, error: Error) => void


export type IpcSocketServerConstructorOptions = ProtocolConfig & ServerConfig

export class IpcSocketServer {

    private _protocolConfig: ProtocolConfig
    private _clients = new Map<UUID, IpcSocket>()
    private _server: Server
    private _messageHandler: MessageHandler
    private _errorHandler: ErrorHandler
    constructor(options: IpcSocketServerConstructorOptions) {
        this._server = new Server({
            allowHalfOpen: options.allowHalfOpen,
            pauseOnConnect: options.pauseOnConnect
        })
        this._messageHandler = options.messageHandler
        this._errorHandler = options.errorHandler
        this._protocolConfig = options
        this._server.on('close', this._onClose.bind(this))
        this._server.on('connection', this._onConnection.bind(this))
        this._server.on('error', this._onError.bind(this))
    }

    public async listen(path: string, timeoutMs?: number): Promise<void> {
        log.debug(`Starting server...`)
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(reject, timeoutMs || 30000)
            this._server.listen(path, () => {
                log.info(`Server listening at ${path}`)
                clearTimeout(timeout)
                resolve()
            })
        }) 
    }

    private _onClose() {
        
    }

    private _onConnection(socket: Socket) {

        const id = new UUID()
        const client = new IpcSocket({
            id: id.toString(),
            socketOrPath: socket,
        }, this._protocolConfig)
        this._clients.set(id, client)
        
        client.messageHandler = (data: Buffer, response: (reply?: Buffer | Promise<Buffer>) => Promise<void>) => {
            return this._onMessage(client, data, response)
        }
        client.errorHandler = (error: Error) => {
            return this._Client_onError(client, error)
        }

    }

    private _onMessage(client: IpcSocket, data: Buffer, response: (reply?: Buffer | Promise<Buffer>) => Promise<void>) : void {
        log.trace(`Message from client: ${client.id}`, data)
        return this._messageHandler(client, data, response)
    }

    private _onError(error: Error) {
        log.error(`Error on server:`, error)
        return this._errorHandler(undefined, error)
    }

    private _Client_onError(client: IpcSocket, error: Error) {
        log.error(`Error on client: ${client.id}`, error)
        return this._errorHandler(client, error)
    }
}


