# ipc-msg

A simple framing protocol for messaging (and RPC) over raw sockets

## Rationale

Scaling and communication between applications on different stacks require communication accross process boundaries. The most effective way to do this is via a socket (like a TCP socket, UNIX socket or Windows pipe).

However, most use cases demand not only some form of message framing but also the ability to match requests and response.

This is a simple framing protocol that also provides:

  1. Message length prefixes to protect from massive overruns if a frame boundary is missed.
  2. UUIDv4 based message identifiers to match requests and responses
  3. Support for both async and synchronous message patterns
  4. ACK and NAK for messages to deal with all possible failure scenarios.

## Protocol

- All messages are idempotent and uniquely identified by a UUID
- All messages are ACK'd or NAK'd
- Request-Response pairs use the same UUID
- Response can be sent instead of ACK

### **UUID**

The UUID uniquely identifies a message exchange between two stations. It may be re-used across connections where an ACK, NAK or reply are sent over a different connection to the original request or event message.

The protocol is HIGHLY dependent on the UUID being universally unique so implementations MUST ensure they generate UUIDs correctly.

### Idempotency, ACK and NAK

If a station is already processing a message it MUST discard any new messages with the same UUID (after optionally responding with an ACK). If the message has already been processed then the station MUST return the same response.

When a station sends an ACK or NAK it signals to the other station:
  1. that the message has been **received**, and 
  2. that the message is either **on a persistent queue** or **has been discarded**.


If a station is able to respond to a message immediately it may send a reply in lieu of an ACK. The sender should treat this as if it has received an ACK and then the reply.

If a station sends a message it must resend the message until it receives an ACK, NAK or response and should attempt to re-send any messages that have not been answered following the restoration of a lost connection.

If a station sends a NAK in response to a reply this indicates to the originator of the reply that it was unable to match the reply to the original request.

## Format

The following message types are defined:

| Message Type               | Framing Format                       |
|----------------------------|--------------------------------------|
| Request/Subscribe          | `<SOH> UUID <STX> LEN MESSAGE <ETX>` |
| Request/Subscription Query | `<SOH> UUID <STX> 0x00 <ETX>`        |
| Reply/Event                | `<SOH> UUID <STX> LEN MESSAGE <EOT>` |
| Reply/Event Query          | `<SOH> UUID <STX> 0x00 <EOT>`        |
| Ack                        | `<SOH> UUID <ACK>`                   |
| Nak                        | `<SOH> UUID <NAK>`                   |

**`<SOH>`** : Start of Header byte (`0x01`)  
**`UUID`**: Unique UUID for the message/message pair (128 bits)  
**`<STX>`**: Start of Text byte (`0x02`)  
**`LEN`**: Length of message  
**`MESSAGE`**: The protocol data (variable length)  
**`<ETX>`**: End of Text byte (`0x03`)  
**`<EOT>`**: End of Transmission byte (`0x04`)  
**`<ACK>`**: ACK byte (`0x06`)  
**`<NAK>`**: NAK byte (`0x15`)  
**`0x00`**: Zero byte (`0x00`)  

**Length**

The length of the message is always provided after the `<STX>` in the header. It is a variable length field. 

If the length of the message is 127 bytes or less then the length field will be the 1 byte unsigned integer value indicating the length. 

If the length of the message field is greater than 127 bytes then the most significant bit of the first byte in the length field is set (i.e. equals 1) and the remaining 7 bits encode the length of the remainder of the length field as a 7-bit unsigend integer (with a maximum of 4).

In the latter case, where the first byte provides the length of the length field (e.g. `X`), then the remaining `X` bytes encode the message length as an unsiged integer with a maximum size of UInt32.MAX.

This is identical to length encoding in the Octet Encoding Rules.

Examples:

| `LEN`            | Length    |
|------------------|-----------|
| `0x00`           | 0         |
| `0x05`           | 5         |
| `0x7F`           | 127       |
| `0x8180`         | 128       | 
| `0x8181`         | 129       |
| `0x82A87B`       | 43131     |
| `0x83F8A658`     | 16295512  |
| `0x8415AB7CEC`   | 363560172 |

**Messaging**

Stations sending a message that expect a reply (or replies in the case of a subscription) should send a `Request/Subscribe` (i.e. terminated with an `<ETX>`). Stations sending a single message (event) or a reply should send it as a `Reply/Event` (i.e. terminated with an `<EOT>`).

Stations should always respond to a `Request/Subscribe` or `Reply/Event`.

Stations that send one of these and don't receive a response should resend the message or send an appropriate query with the same UUID and terminating character.

**Query**

A query can be sent following any request, using the same UUID, to request that the response is resent.

## Flow

The two parties establish an IPC channel on which they can begin communication. This could be a raw TCP/UDP or OS socket. The protocol has no handshake and either party may begin sending messages as soon as the connection is established. The protocol can use unreliable transports like UDP.

## Simple Async Messaging (Events)

**Successful Send**

    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0BHello World<EOT>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<ACK>

**Temporary Failure**

    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0BHello World<EOT>
    Receiver: *DIDN'T RECEIVE or DISCARD or IGNORE*
    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0BHello World<EOT>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<ACK>

**Permanent Failure**

    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0BHello World<EOT>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<NAK>

## Request-Response Messaging

**Successful Send (No ACK for Request)**

    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0CHello World?<ETX>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x06Hello!<EOT>
    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<ACK>

**Successful Send**

    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0CHello World?<ETX>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<ACK>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x06Hello!<EOT>
    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<ACK>

**Temporary Request Failure**

    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0CHello World?<ETX>
    Receiver: *DIDN'T RECEIVE* or *DISCARD or IGNORE*
    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0CHello World?<ETX>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x06Hello!<EOT>
    Sender:   <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<ACK>

**Permanent Failure**

    Sender: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<STX>0x0CHello World<ETX>
    Receiver: <SOH>ffa0f5b3-c3dc-4dd2-aec5-c3d54e741c6c<NAK>

## Using the module

This module implements the protocol by providing an IpcServer and IpcSocket implementation. This wraps or instantiates an implementation of `net.Socket`

### Install

```shell
npm install ipc-msg
```

### Server

```javascript
    import { IpcSocket, IpcSocketServer, MessageHandler } from 'ipc-msg'
    
    const messageHandler: MessageHandler = (client: IpcSocket, data: Buffer, response: (reply?: Buffer | Promise<Buffer>) => Promise<void>) => { 

        response(new Promise<Buffer>((resolve) =>{
            resolve(reply)
        })).catch((e)=>{
            console.error("Error sending reply", e)
        })

    }
    const server = new IpcSocketServer({
        messageHandler,
        errorHandler: console.error,
        ackTimeoutMs: 1000,
        maxRetries: 5,
        replyTimeoutMs: 5000
    })
    
    await server.listen('./ipc.sock')
```

### Client

```javascript
    const client = new IpcSocket({
        id : "MyClient",
        socketOrPath: './ipc.sock',
        messageHandler: (data) => {
            console.log(`Got reply of ${data.length} bytes`)
        },
        errorHandler: (error) => {
            console.error(error)
        }
    }, new DefaultConfig())

    const data = Buffer.from('Hello World')
    client.sendRequest(data), () => {
            //Handle request ACK
        }
    }).then((reponse) => {
        //Handle response
    }).catch((e) => {
        //Handle error
    })
 
    client.sendMessage(data).then(() => {
        //Handle ACK
    }).catch( (e) => {
        //Handle error
    })

```

# TODO

Implement and document event subscriptions