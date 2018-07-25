"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const socket_1 = require("./socket");
const crypto_1 = require("crypto");
const server_1 = require("./server");
const protocol_1 = require("./protocol");
const mockHandler = (client, data, response) => {
    const message = data.toString('utf8');
    const reply = Buffer.from(message + ' REPLY');
    if (message === 'MESSAGE') {
        response().catch((e) => {
            console.error("Error sending message", e);
        });
        return;
    }
    if (message === 'REQUEST_ASYNC') {
        response(new Promise((resolve) => {
            resolve(reply);
        })).catch((e) => {
            console.error("Error sending message", e);
        });
        return;
    }
    if (message === 'REQUEST_SYNC') {
        response(reply).catch((e) => {
            console.error("Error sending message", e);
        });
        return;
    }
    if (message === 'REQUEST_ASYNC_ERROR') {
        response(new Promise((resolve, reject) => {
            reject(new Error("Error getting response."));
            resolve;
        }));
        return;
    }
    if (message === 'REQUEST_SYNC_ERROR') {
        throw new Error("Error getting response.");
    }
};
(() => __awaiter(this, void 0, void 0, function* () {
    const server = new server_1.IpcSocketServer({
        allowHalfOpen: false,
        pauseOnConnect: false,
        messageHandler: mockHandler,
        errorHandler: () => { },
        ackTimeoutMs: 5000,
        maxRetries: 5,
        throwOnUnsolictedResponse: true,
        replyTimeoutMs: 5000,
        retryWithQuery: false
    });
    yield server.listen('./ipc.sock');
    const client = new socket_1.IpcSocket({
        id: "test-client",
        socketOrPath: './ipc.sock',
        messageHandler: (data) => {
            console.log(`Got reply of ${data.length} bytes`);
        },
        errorHandler: (error) => {
            console.error(error);
        }
    }, new protocol_1.DefaultConfig());
    const messages = {
        message_ack: ['MESSAGE', 'ACK'],
        request_ack_reply: ['REQUEST_ASYNC', 'ACK', 'REPLY'],
        request_reply: ['REQUEST_SYNC', 'REPLY'],
        request_ack_nak: ['REQUEST_ASYNC_ERROR', 'ACK', 'NAK'],
        request_nak: ['REQUEST_SYNC_ERROR', 'NAK'],
    };
    for (let i = 0; i < 10; i++) {
        let messageId = Object.keys(messages)[(crypto_1.randomBytes(1)[0] % 5)];
        // messageId = Object.keys(messages)[4]
        const message = messages[messageId][0];
        const expectedReply1 = messages[messageId][1];
        const expectedReply2 = messages[messageId][2] || false;
        console.log(`SENDING: ${messageId}`);
        if (message === 'MESSAGE') {
            yield client.sendMessage(Buffer.from(message, 'utf8'));
            continue;
        }
        try {
            const response = yield client.sendRequest(Buffer.from(message, 'utf8'), () => {
                if (expectedReply1 !== 'ACK') {
                    throw new Error("Unexpected ACK");
                }
            });
            const reply = response.toString('utf8');
            if (expectedReply1 === 'REPLY' && reply !== message + ' REPLY') {
                throw new Error("Invalid reply");
            }
            if (expectedReply2 && expectedReply2 === 'REPLY' && reply !== message + ' REPLY') {
                throw new Error("Invalid async reply");
            }
        }
        catch (e) {
            if (expectedReply1 !== 'NAK' && expectedReply2 !== 'NAK') {
                throw new Error("Unexpected NAK");
            }
        }
    }
    console.log('DONE');
}))();
//# sourceMappingURL=index.js.map