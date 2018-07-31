import { ListenOptions, Server, Socket } from 'net'
import { create as createLogger, Logger } from '../log'
import { ProtocolConfig, UUID } from '../protocol'
import { IpcSocket } from '../socket'

export type ConnectHandler = (socket: IpcSocket) => void
export type CloseHandler = (source: IpcSocketServer) => void
export type ErrorHandler = (source: IpcSocketServer, error: Error) => void
export interface ServerConfig {
    id: string
    connectHandler: ConnectHandler
    closeHandler: CloseHandler
    errorHandler: ErrorHandler
}

export class IpcSocketServer {
    private _id: string
    private _protocolConfig: ProtocolConfig
    private _clients = new Map<string, IpcSocket>()
    private _server: Server
    private _connectionHandler: ConnectHandler
    private _closeHandler: CloseHandler
    private _errorHandler: ErrorHandler
    private _log: Logger

    constructor(config: ServerConfig, protocolConfig: ProtocolConfig) {
        this._server = new Server({
            allowHalfOpen: false,
            pauseOnConnect: false,
        })

        this._id = config.id
        this._connectionHandler = config.connectHandler
        this._errorHandler = config.errorHandler
        this._closeHandler = config.closeHandler
        this._protocolConfig = protocolConfig
        this._server.on('close', this._Server_onClose.bind(this))
        this._server.on('connection', this._Server_onConnection.bind(this))
        this._server.on('error', this._Server_onError.bind(this))
        this._log = createLogger('ipc-server:' + config.id)
    }

    public get id() {
        return this._id
    }

    public async listen(options: ListenOptions, timeoutMs?: number): Promise<IpcSocketServer> {
        this._log.debug(`Starting server...`)
        return new Promise<IpcSocketServer>((resolve, reject) => {
            const timeout = setTimeout(reject, timeoutMs || 5000)
            this._server.listen(options, () => {
                this._log.info(`Server listening: ${JSON.stringify(options)}`)
                clearTimeout(timeout)
                resolve(this)
            })
        })
    }

    public async close(timeoutMs?: number): Promise<IpcSocketServer> {
        this._log.debug(`Stopping server...`)
        return new Promise<IpcSocketServer>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out trying to close server.'))
            }, timeoutMs || 10000)

            this._clients.forEach(client => client.close())
            this._server.close(() => {
                clearTimeout(timeout)
                this._server.unref()
                resolve(this)
            })
        })
    }

    private _Server_onClose() {
        this._log.info('Server closed')
        this._closeHandler(this)
    }

    private _Server_onConnection(socket: Socket) {
        const id = new UUID().toString()
        const client = new IpcSocket({ id }, this._protocolConfig, socket)
        this._clients.set(id, client)
        this._log.info(`Client ${id} connected`)
        this._connectionHandler(client)
    }

    private _Server_onError(error: Error) {
        this._log.error(`Error on server:`, error)
        this._errorHandler(this, error)
    }
}
