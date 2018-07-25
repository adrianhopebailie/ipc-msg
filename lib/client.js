"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ipc = require("node-ipc");
ipc.config.id = 'hello';
ipc.config.retry = 1500;
ipc.connectTo('connector', function () {
    ipc.of.connector.on('connect', function () {
        ipc.log('## connected to world ##', ipc.config);
        ipc.of.connector.emit('message', 'hello');
    });
    ipc.of.connector.on('disconnect', function () {
        ipc.log('disconnected from world');
    });
    ipc.of.connector.on('message', function (data) {
        ipc.log('got a message from world : ', data);
    });
});
