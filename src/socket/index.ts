import { UUID } from '../protocol'

export { default as IpcSocket } from './ipcSocket'
export { ErrorHandler, SocketConfig, MessageHandler } from './ipcSocket'

export interface CachedMessage {
    id: UUID
    lastModified: number
}
