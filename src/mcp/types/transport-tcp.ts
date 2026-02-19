import { EventEmitter } from "events";
import { JSONRPCMessage } from "./protocol.js";
import { BaseTransport, TransportInfo } from "./transport.js";

/**
 * TCP Transport for MCP
 *
 * Provides TCP socket communication between host and bridge container.
 * Used by HabitatBridgeClient to connect to BridgeServer.
 */

export interface TcpTransportConfig {
  host: string;
  port: number;
  timeout?: number;
}

export class TcpTransport extends BaseTransport {
  private config: TcpTransportConfig;
  private socket?: any; // net.Socket
  private messageBuffer: string = "";
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;

  constructor(config: TcpTransportConfig) {
    super("tcp");
    this.config = {
      timeout: 30000,
      ...config,
    };
    this._info = {
      type: "tcp",
      connected: false,
      metadata: {
        host: config.host,
        port: config.port,
      },
    };
  }

  async start(): Promise<void> {
    if (this._connected) {
      throw new Error("Transport already connected");
    }

    try {
      const { createConnection } = await import("net");

      this.socket = createConnection(
        {
          host: this.config.host,
          port: this.config.port,
          timeout: this.config.timeout,
        },
        () => {
          this.setConnected(true);
          this.reconnectAttempts = 0;
        },
      );

      this.socket.on("data", (data: Buffer) => {
        this.handleData(data);
      });

      this.socket.on("error", (error: Error) => {
        this.handleError(error);
      });

      this.socket.on("close", () => {
        this.setConnected(false);
      });

      this.socket.on("timeout", () => {
        this.handleError(new Error("Connection timeout"));
        this.socket?.destroy();
      });

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const onConnect = () => {
          resolve();
        };
        const onError = (error: Error) => {
          reject(error);
        };
        this.socket!.once("connect", onConnect);
        this.socket!.once("error", onError);
      });
    } catch (error) {
      throw new Error(
        `Failed to connect to TCP transport: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return;
    }

    return new Promise((resolve) => {
      this.socket!.end(() => {
        this.socket!.destroy();
        this.socket = undefined;
        this.setConnected(false);
        resolve();
      });
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected || !this.socket) {
      throw new Error("Transport not connected");
    }

    const json = JSON.stringify(message);
    const data = json + "\n"; // Newline-delimited JSON

    return new Promise((resolve, reject) => {
      this.socket!.write(data, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  getInfo(): TransportInfo {
    return {
      ...super.getInfo(),
      metadata: {
        ...this._info.metadata,
        reconnectAttempts: this.reconnectAttempts,
      },
    };
  }

  private handleData(data: Buffer): void {
    this.messageBuffer += data.toString("utf-8");

    // Process complete messages (newline-delimited)
    let newlineIndex: number;
    while ((newlineIndex = this.messageBuffer.indexOf("\n")) !== -1) {
      const messageStr = this.messageBuffer.substring(0, newlineIndex);
      this.messageBuffer = this.messageBuffer.substring(newlineIndex + 1);

      if (messageStr.trim()) {
        try {
          const message = JSON.parse(messageStr) as JSONRPCMessage;
          this.handleMessage(message);
        } catch (error) {
          this.handleError(new Error(`Failed to parse message: ${messageStr}`));
        }
      }
    }
  }

  async reconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return false;
    }

    this.reconnectAttempts++;

    try {
      await this.close();
      await this.start();
      return true;
    } catch {
      return false;
    }
  }
}
