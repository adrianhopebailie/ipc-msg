/// <reference types="node" />
import * as riverpig from 'riverpig/dist/src';
declare type LoggerConfig = riverpig.LoggerConfig;
export declare class Logger {
    river: any;
    tracer: any;
    constructor(namespace: string, config0?: LoggerConfig);
    info(...msg: any[]): void;
    warn(...msg: any[]): void;
    error(...msg: any[]): void;
    debug(...msg: any[]): void;
    trace(...msg: any[]): void;
}
export declare const createRaw: (namespace: string) => Logger;
export declare const create: (namespace: string) => Logger;
export declare const setOutputStream: (newOutputStream: NodeJS.WriteStream) => void;
export {};
