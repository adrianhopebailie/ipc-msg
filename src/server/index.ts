import { Server, Socket } from 'net'
import { create as createLogger, Logger } from '../log'
import { ProtocolConfig, UUID } from '../protocol'
import { ErrorHandler, IpcSocket, MessageHandler } from '../socket'

export type ConnectHandler = (socket: IpcSocket) => void

export interface ServerConfig {
    id: string
    connectHandler: ConnectHandler
    messageHandler: MessageHandler
    errorHandler: ErrorHandler
    allowHalfOpen?: boolean
    pauseOnConnect?: boolean
}

export class IpcSocketServer {
    private _id: string
    private _protocolConfig: ProtocolConfig
    private _clients = new Map<string, IpcSocket>()
    private _server: Server
    private _connectHandler: ConnectHandler
    private _messageHandler: MessageHandler
    private _errorHandler: ErrorHandler
    private _log: Logger

    constructor(config: ServerConfig, protocolConfig: ProtocolConfig) {
        this._server = new Server({
            allowHalfOpen: config.allowHalfOpen,
            pauseOnConnect: config.pauseOnConnect,
        })
        this._id = config.id
        this._connectHandler = config.connectHandler
        this._messageHandler = config.messageHandler
        this._errorHandler = config.errorHandler
        this._protocolConfig = protocolConfig
        this._server.on('close', this._onClose.bind(this))
        this._server.on('connection', this._onConnection.bind(this))
        this._server.on('error', this._onError.bind(this))
        this._log = createLogger('ipc-server:' + config.id)
    }

    public get id() {
        return this._id
    }

    public async listen(path: string, timeoutMs?: number): Promise<void> {
        this._log.debug(`Starting server...`)
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(reject, timeoutMs || 5000)
            this._server.listen(path, () => {
                this._log.info(`Server listening at ${path}`)
                clearTimeout(timeout)
                resolve()
            })
        })
    }

    public async close(timeoutMs?: number) {
        this._log.debug(`Stopping server...`)
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(reject, timeoutMs || 5000)
            this._server.close(() => {
                clearTimeout(timeout)
                resolve()
            })
        })
    }

    private _onClose() {
        this._log.info('Server closed')
    }

    private _onConnection(socket: Socket) {
        const id = new UUID()
        const client = new IpcSocket(
            {
                id: id.toString(),
                socketOrPath: socket,
            },
            this._protocolConfig,
        )
        this._clients.set(id.toString(), client)

        client.messageHandler = this._Client_onMessage.bind(this)
        client.errorHandler = this._Client_onError.bind(this)

        this._connectHandler(client)
    }

    private _onError(error: Error) {
        this._log.error(`Error on server:`, error)
        return this._errorHandler(this, error)
    }

    private _Client_onMessage(
        client: IpcSocket,
        data: Buffer,
        response: (reply?: Buffer | Promise<Buffer>) => Promise<void>,
    ): void {
        this._log.trace(`Message from client: ${client.id}`, data)
        return this._messageHandler(client, data, response)
    }

    private _Client_onError(client: IpcSocket, error: Error) {
        this._log.error(`Error on client: ${client.id}`, error)
        return this._errorHandler(client, error)
    }
}
