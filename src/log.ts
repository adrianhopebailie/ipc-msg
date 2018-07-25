import * as debug from 'debug'
import * as riverpig from 'riverpig/dist/src'
import * as through2 from 'through2'
type LoggerConfig = riverpig.LoggerConfig

let outputStream = process.stdout
const logStream = through2()
logStream.pipe(outputStream)

export class Logger {
    public river: any
    public tracer: any

    constructor(namespace: string, config0?: LoggerConfig) {
        this.river = riverpig(namespace, config0)
        this.tracer = this.river.trace || debug(namespace + ':trace')
    }

    public info(...msg: any[]): void {
        this.river.info(msg)
    }

    public warn(...msg: any[]): void {
        this.river.warn(msg)
    }

    public error(...msg: any[]): void {
        this.river.error(msg)
    }

    public debug(...msg: any[]): void {
        this.river.debug(msg)
    }

    public trace(...msg: any[]): void {
        this.tracer(msg)
    }
}

export const createRaw = (namespace: string): Logger => {
    return new Logger(namespace, {
        stream: logStream,
    })
}
export const create = (namespace: string) => createRaw('ipc-rpc:' + namespace)

export const setOutputStream = (newOutputStream: NodeJS.WriteStream) => {
    logStream.unpipe(outputStream)
    logStream.pipe(newOutputStream)
    outputStream = newOutputStream
}
