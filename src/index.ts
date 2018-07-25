import { IpcSocket } from "./socket";
import { randomBytes } from "crypto";
import { IpcSocketServer, MessageHandler } from "./server";
import { DefaultConfig } from "./protocol";

const mockHandler: MessageHandler = (client: IpcSocket, data: Buffer, response: (reply?: Buffer | Promise<Buffer>) => Promise<void>) => { 

    const message = data.toString('utf8')
    const reply = Buffer.from(message + ' REPLY')
    if(message === 'MESSAGE') {
        response().catch((e : any)=>{
            console.error("Error sending message", e)
        })    
        return
    }
    if(message === 'REQUEST_ASYNC') {
        response(new Promise<Buffer>((resolve) =>{
            resolve(reply)
        })).catch((e)=>{
            console.error("Error sending message", e)
        })    
        return
    }
    if(message === 'REQUEST_SYNC') {
        response(reply).catch((e)=>{
            console.error("Error sending message", e)
        }) 
        return
    }
    if(message === 'REQUEST_ASYNC_ERROR'){
        response(new Promise<Buffer>((resolve, reject) =>{
            reject(new Error("Error getting response."))
            resolve
        }))   
        return
    }
    if(message === 'REQUEST_SYNC_ERROR'){
        throw new Error("Error getting response.")
    }
}

(async () => {
    const server = new IpcSocketServer({
        allowHalfOpen: false,
        pauseOnConnect: false,
        messageHandler: mockHandler,
        errorHandler: () => {},
        ackTimeoutMs: 5000,
        maxRetries: 5,
        throwOnUnsolictedResponse: true,
        replyTimeoutMs: 5000,
        retryWithQuery: false
    })
    
    await server.listen('./ipc.sock')
    const client = new IpcSocket({
        id : "test-client",
        socketOrPath: './ipc.sock',
        messageHandler: (data) => {
            console.log(`Got reply of ${data.length} bytes`)
        },
        errorHandler: (error) => {
            console.error(error)
        }
    }, new DefaultConfig())

    const messages : { [key: string]: string[] } = {
        message_ack : ['MESSAGE','ACK'], 
        request_ack_reply : ['REQUEST_ASYNC', 'ACK', 'REPLY'],
        request_reply : ['REQUEST_SYNC', 'REPLY'], 
        request_ack_nak: ['REQUEST_ASYNC_ERROR', 'ACK', 'NAK'],
        request_nak: ['REQUEST_SYNC_ERROR', 'NAK'],
    }

    for(let i = 0; i < 10; i++) {

        let messageId = Object.keys(messages)[(randomBytes(1)[0] % 5)]
        // messageId = Object.keys(messages)[4]
        const message = messages[messageId][0]
        const expectedReply1 = messages[messageId][1]
        const expectedReply2 = messages[messageId][2] || false

        console.log(`SENDING: ${messageId}`)

        if(message === 'MESSAGE') {
            await client.sendMessage(Buffer.from(message, 'utf8'))
            continue
        }

        
        try {
            const response = await client.sendRequest(Buffer.from(message, 'utf8'), () => {
                if(expectedReply1 !== 'ACK') {
                    throw new Error("Unexpected ACK")
                }
            })
            
            const reply = response.toString('utf8')

            if(expectedReply1 === 'REPLY' && reply !== message + ' REPLY') {
                throw new Error("Invalid reply")
            }
            if(expectedReply2 && expectedReply2 === 'REPLY' && reply !== message + ' REPLY') {
                        throw new Error("Invalid async reply")
            }
        }
        catch(e) {
            if(expectedReply1 !== 'NAK' && expectedReply2 !== 'NAK') {
                throw new Error("Unexpected NAK")
            }
        }
    }
    console.log('DONE')
})()
