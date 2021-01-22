import {ApiGatewayChannel} from "./ApiGatewayChannel";
import {AxiosResponse} from "axios";

export type Options = { authEndpoint: string, host: string };
export type MessageBody = { event: string, channel?: string, data: object };

export class OurConnector
{
    buffer: Array<object> = [];

    options: Options;

    websocket: WebSocket;

    private internalListeners: { [index: string]: Function } = {};

    private channelBacklog = [];

    private channels: { [index: string]: ApiGatewayChannel } = {};

    private socketId: string;

    private pingInterval: NodeJS.Timeout;

    constructor(options: Options) {
        this.options = options;

        this.websocket = new WebSocket(options.host)

        this.websocket.onopen = () => {
            while (this.buffer.length) {
                const message = this.buffer[0]

                this.send(message)

                this.buffer.splice(0, 1)
            }
        }

        this.websocket.onmessage = (messageEvent: MessageEvent) => {
            const message = this.parseMessage(messageEvent.data)

            if (!message) {
                return
            }

            if (message.channel) {
                console.log(`Received event ${message.event} on channel ${message.channel}`)

                if (this.channels[message.channel]) {
                    this.channels[message.channel].handleEvent(message.event, message.data)
                }

                return
            }

            if (this.internalListeners[message.event]) {
                this.internalListeners[message.event](message.data)
            }
        }

        this.on('whoami', ({ socket_id: socketId }) => {
            this.socketId = socketId

            console.log(`just set socketId to ${socketId}`)

            while (this.channelBacklog.length) {
                const channel = this.channelBacklog[0]

                this.actuallySubscribe(channel)

                this.channelBacklog.splice(0, 1)
            }
        })

        this.send({
            event: 'whoami',
        })

        // send ping every 10 seconds to keep connection alive
        this.pingInterval = setInterval(() => {
            console.log('Sending ping')

            this.send({
                event: 'ping',
            })
        }, 10 * 1000)

        return this
    }

    protected parseMessage(body: string): MessageBody {
        try {
            return JSON.parse(body)
        } catch (error) {
            console.error(error)

            return undefined
        }
    }

    getSocketId(): string {
        return this.socketId
    }

    private socketIsReady(): boolean {
        return this.websocket.readyState === this.websocket.OPEN
    }

    send(message: object): void {
        if (this.socketIsReady()) {
            this.websocket.send(JSON.stringify(message))
            return
        }

        this.buffer.push(message)
    }

    close (): void {
        this.internalListeners = {}

        clearInterval(this.pingInterval)
        this.pingInterval = undefined

        this.websocket.close()
    }

    subscribe(channel: ApiGatewayChannel): void {
        if (this.getSocketId()) {
            this.actuallySubscribe(channel)
        } else {
            this.channelBacklog.push(channel)
        }
    }

    private actuallySubscribe(channel: ApiGatewayChannel): void {
        if (channel.name.startsWith('private-') || channel.name.startsWith('presence-')) {
            console.log(`Sending auth request for channel ${channel.name}`)

            axios.post(this.options.authEndpoint, {
                socket_id: this.getSocketId(),
                channel_name: channel.name,
            }).then((response: AxiosResponse) => {
                console.log(`Subscribing to channels ${channel.name}`)

                this.send({
                    event: 'subscribe',
                    data: {
                        channel: channel.name,
                        auth: response.data.auth,
                    },
                })

                this.channels[channel.name] = channel
            }).catch((error) => {
                console.log(`Auth request for channel ${channel.name} failed`)
            })
        } else {
            console.log(`Subscribing to channels ${channel.name}`)

            this.send({
                event: 'subscribe',
                data: {
                    channel: channel.name,
                },
            })

            this.channels[channel.name] = channel
        }
    }

    unsubscribe(channel: ApiGatewayChannel): void {
        this.send({
            event: 'unsubscribe',
            data: {
                channel: channel.name,
            },
        })

        delete this.channels[channel.name]
    }

    on(event: string, callback: Function = null): void {
        this.internalListeners[event] = callback
    }

    unbindEvent(event: string, callback: Function = null): void {
        if (this.internalListeners[event] && (callback === null || this.internalListeners[event] === callback)) {
            delete this.internalListeners[event]
        }
    }
}
