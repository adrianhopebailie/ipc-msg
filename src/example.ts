import { randomBytes } from 'crypto'
import { DefaultIpcConfig, IpcMessageHandler, IpcSocket, IpcSocketServer } from '.'

/* tslint:disable:no-console */

const mockHandler: IpcMessageHandler = (
    client: IpcSocket,
    data: Buffer,
    response: (reply?: Buffer | Promise<Buffer>) => Promise<void>,
) => {
    const message = data.toString('utf8')
    const reply = Buffer.from(message + ' REPLY')
    if (message === 'MESSAGE') {
        response().catch((e: any) => {
            console.error('Error sending message', e)
        })
        return
    }
    if (message === 'REQUEST_ASYNC') {
        response(
            new Promise<Buffer>(resolve => {
                resolve(reply)
            }),
        ).catch(e => {
            console.error('Error sending message', e)
        })
        return
    }
    if (message === 'REQUEST_ASYNC_DELAY') {
        response(
            new Promise<Buffer>(resolve => {
                setTimeout(() => {
                    resolve(reply)
                }, 5000)
            }),
        ).catch(e => {
            console.error('Error sending message', e)
        })
        return
    }
    if (message === 'REQUEST_SYNC') {
        response(reply).catch(e => {
            console.error('Error sending message', e)
        })
        return
    }
    if (message === 'REQUEST_ASYNC_ERROR') {
        response(
            new Promise<Buffer>((resolve, reject) => {
                reject(new Error('Error getting response.'))
            }),
        )
        return
    }
    if (message === 'REQUEST_SYNC_ERROR') {
        throw new Error('Error getting response.')
    }
}
;(async () => {
    const server = new IpcSocketServer(
        {
            id: 'TEST-SERVER',
            connectHandler: (socket: IpcSocket) => {
                socket.messageHandler = mockHandler
            },
            errorHandler: (source, error) => {
                console.error('Server error', source, error)
            },
            closeHandler: () => {
                /* NOOP */
            },
        },
        new DefaultIpcConfig(),
    )

    await server.listen({ path: './ipc.sock' })
    const client = new IpcSocket(
        {
            id: 'test-client',
            messageHandler: (socket, data) => {
                console.log(`Got reply of ${data.length} bytes from socket ${socket.id}`)
            },
            errorHandler: (socket, error) => {
                console.error(`Error on socket ${socket.id}`, error)
            },
        },
        new DefaultIpcConfig(),
    )

    await client.connect({ path: './ipc.sock' })

    const messages: { [key: string]: string[] } = {
        message_ack: ['MESSAGE', 'ACK'],
        request_ack_reply: ['REQUEST_ASYNC', 'ACK', 'REPLY'],
        request_ack_delayreply: ['REQUEST_ASYNC_DELAY', 'ACK', 'REPLY'],
        request_reply: ['REQUEST_SYNC', 'REPLY'],
        request_ack_nak: ['REQUEST_ASYNC_ERROR', 'ACK', 'NAK'],
        request_nak: ['REQUEST_SYNC_ERROR', 'NAK'],
    }

    process.on('SIGINT', () => {
        client.close().then(() => {
            server.close().then(() => {
                process.exit(0)
            })
        })
    })

    for (let i = 0; i < 1000; i++) {
        const messageId = Object.keys(messages)[randomBytes(1)[0] % 5]
        const message = messages[messageId][0]
        const expectedReply1 = messages[messageId][1]
        const expectedReply2 = messages[messageId][2] || false

        console.log(`SENDING: ${messageId}`)

        if (message === 'MESSAGE') {
            await client.sendMessage(Buffer.from(message, 'utf8'))
            continue
        }

        try {
            const response = await client.sendRequest(Buffer.from(message, 'utf8'), () => {
                if (expectedReply1 !== 'ACK') {
                    throw new Error('Unexpected ACK')
                }
            })

            const reply = response.toString('utf8')

            if (expectedReply1 === 'REPLY' && reply !== message + ' REPLY') {
                throw new Error('Invalid reply')
            }
            if (expectedReply2 && expectedReply2 === 'REPLY' && reply !== message + ' REPLY') {
                throw new Error('Invalid async reply')
            }
        } catch (e) {
            if (expectedReply1 !== 'NAK' && expectedReply2 !== 'NAK') {
                throw new Error('Unexpected NAK')
            }
        }
    }
    console.log('DONE')
})()
