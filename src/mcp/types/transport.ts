import { EventEmitter } from 'events';
import { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from './protocol.js';

/**
 * MCP Transport Layer Abstractions
 * 
 * This file defines the transport layer interfaces and base classes
 * for MCP communication over different protocols (stdio, SSE, WebSocket).
 */

// =============================================================================
// Transport Interface
// =============================================================================

export interface MCPTransport extends EventEmitter {
  /**
   * Start the transport connection
   */
  start(): Promise<void>;

  /**
   * Close the transport connection
   */
  close(): Promise<void>;

  /**
   * Send a message through the transport
   */
  send(message: JSONRPCMessage): Promise<void>;

  /**
   * Check if the transport is connected
   */
  isConnected(): boolean;

  /**
   * Get transport-specific information
   */
  getInfo(): TransportInfo;
}

export interface TransportInfo {
  type: 'stdio' | 'sse' | 'websocket';
  connected: boolean;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Transport Events
// =============================================================================

export interface MCPTransportEvents {
  'message': (message: JSONRPCMessage) => void;
  'connect': () => void;
  'disconnect': () => void;
  'error': (error: Error) => void;
}

// =============================================================================
// Base Transport Class
// =============================================================================

export abstract class BaseTransport extends EventEmitter implements MCPTransport {
  protected _connected: boolean = false;
  protected _info: TransportInfo;

  constructor(type: TransportInfo['type']) {
    super();
    this._info = {
      type,
      connected: false,
    };
  }

  abstract start(): Promise<void>;
  abstract close(): Promise<void>;
  abstract send(message: JSONRPCMessage): Promise<void>;

  isConnected(): boolean {
    return this._connected;
  }

  getInfo(): TransportInfo {
    return {
      ...this._info,
      connected: this._connected,
    };
  }

  protected setConnected(connected: boolean): void {
    this._connected = connected;
    this._info.connected = connected;
    
    if (connected) {
      this.emit('connect');
    } else {
      this.emit('disconnect');
    }
  }

  protected handleMessage(message: JSONRPCMessage): void {
    this.emit('message', message);
  }

  protected handleError(error: Error): void {
    this.emit('error', error);
  }
}

// =============================================================================
// Stdio Transport
// =============================================================================

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export class StdioTransport extends BaseTransport {
  private config: StdioTransportConfig;
  private process?: any; // Child process
  private messageBuffer: string = '';

  constructor(config: StdioTransportConfig) {
    super('stdio');
    this.config = config;
  }

  async start(): Promise<void> {
    if (this._connected) {
      throw new Error('Transport already connected');
    }

    try {
      const { spawn } = await import('child_process');
      
      this.process = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.on('error', (error: Error) => {
        this.handleError(new Error(`Process error: ${error.message}`));
      });

      this.process.on('exit', (code: number, signal: string) => {
        this.setConnected(false);
        if (code !== 0) {
          this.handleError(new Error(`Process exited with code ${code}, signal ${signal}`));
        }
      });

      // Handle stdout messages
      this.process.stdout.on('data', (data: Buffer) => {
        this.handleStdoutData(data.toString());
      });

      this.process.stderr.on('data', (data: Buffer) => {
        // Log stderr for debugging but don't treat as error
        console.error(`MCP Server stderr: ${data.toString()}`);
      });

      this.setConnected(true);
    } catch (error) {
      throw new Error(`Failed to start stdio transport: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async close(): Promise<void> {
    if (this.process && this._connected) {
      this.process.kill();
      this.process = undefined;
      this.setConnected(false);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected || !this.process) {
      throw new Error('Transport not connected');
    }

    const serialized = JSON.stringify(message) + '\n';
    
    return new Promise((resolve, reject) => {
      this.process.stdin.write(serialized, (error: Error | null) => {
        if (error) {
          reject(new Error(`Failed to send message: ${error.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  private handleStdoutData(data: string): void {
    this.messageBuffer += data;
    
    // Process complete messages (separated by newlines)
    const lines = this.messageBuffer.split('\n');
    this.messageBuffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line.trim());
          this.handleMessage(message);
        } catch (error) {
          this.handleError(new Error(`Failed to parse message: ${line}`));
        }
      }
    }
  }
}

// =============================================================================
// SSE Transport
// =============================================================================

export interface SSETransportConfig {
  url: string;
  headers?: Record<string, string>;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class SSETransport extends BaseTransport {
  private config: SSETransportConfig;
  private eventSource?: EventSource;
  private reconnectAttempts: number = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(config: SSETransportConfig) {
    super('sse');
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this._connected) {
      throw new Error('Transport already connected');
    }

    await this.connect();
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }

    this.setConnected(false);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected) {
      throw new Error('Transport not connected');
    }

    // For SSE, we typically send messages via HTTP POST to a separate endpoint
    const response = await fetch(this.config.url.replace('/sse', '/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  private async connect(): Promise<void> {
    try {
      // Note: EventSource is not available in Node.js by default
      // This would need a polyfill like 'eventsource' package
      const EventSource = (globalThis as any).EventSource;
      if (!EventSource) {
        throw new Error('EventSource not available. Install eventsource package for Node.js');
      }

      this.eventSource = new EventSource(this.config.url, {
        headers: this.config.headers,
      });

      if (this.eventSource) {
        this.eventSource.onopen = () => {
          this.reconnectAttempts = 0;
          this.setConnected(true);
        };

        this.eventSource.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            this.handleError(new Error(`Failed to parse SSE message: ${event.data}`));
          }
        };

        this.eventSource.onerror = () => {
          this.setConnected(false);
          this.scheduleReconnect();
        };
      }

    } catch (error) {
      throw new Error(`Failed to connect SSE transport: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 5)) {
      this.handleError(new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.handleError(error);
      });
    }, this.config.reconnectInterval);
  }
}

// =============================================================================
// WebSocket Transport
// =============================================================================

export interface WebSocketTransportConfig {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export class WebSocketTransport extends BaseTransport {
  private config: WebSocketTransportConfig;
  private websocket?: WebSocket;
  private reconnectAttempts: number = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(config: WebSocketTransportConfig) {
    super('websocket');
    this.config = {
      reconnectInterval: 5000,
      maxReconnectAttempts: 5,
      ...config,
    };
  }

  async start(): Promise<void> {
    if (this._connected) {
      throw new Error('Transport already connected');
    }

    await this.connect();
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.websocket) {
      this.websocket.close();
      this.websocket = undefined;
    }

    this.setConnected(false);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected || !this.websocket) {
      throw new Error('Transport not connected');
    }

    return new Promise((resolve, reject) => {
      const serialized = JSON.stringify(message);
      
             if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
         this.websocket.send(serialized);
         resolve();
       } else {
         reject(new Error('WebSocket not in OPEN state'));
       }
    });
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Note: WebSocket might need polyfill in Node.js
        const WebSocketClass = (globalThis as any).WebSocket || require('ws');
        
        this.websocket = new WebSocketClass(this.config.url, this.config.protocols, {
          headers: this.config.headers,
        });

                 if (this.websocket) {
           this.websocket.onopen = () => {
             this.reconnectAttempts = 0;
             this.setConnected(true);
             resolve();
           };

           this.websocket.onmessage = (event) => {
             try {
               const message = JSON.parse(event.data);
               this.handleMessage(message);
             } catch (error) {
               this.handleError(new Error(`Failed to parse WebSocket message: ${event.data}`));
             }
           };

           this.websocket.onclose = () => {
             this.setConnected(false);
             this.scheduleReconnect();
           };

           this.websocket.onerror = (error) => {
             this.handleError(new Error(`WebSocket error: ${error}`));
             reject(error);
           };
         } else {
           reject(new Error('Failed to create WebSocket instance'));
         }

      } catch (error) {
        reject(new Error(`Failed to create WebSocket: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 5)) {
      this.handleError(new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.handleError(error);
      });
    }, this.config.reconnectInterval);
  }
}

// =============================================================================
// Transport Factory
// =============================================================================

export type TransportConfig = 
  | ({ type: 'stdio' } & StdioTransportConfig)
  | ({ type: 'sse' } & SSETransportConfig)
  | ({ type: 'websocket' } & WebSocketTransportConfig);

export function createTransport(config: TransportConfig): MCPTransport {
  switch (config.type) {
    case 'stdio':
      return new StdioTransport(config);
    case 'sse':
      return new SSETransport(config);
    case 'websocket':
      return new WebSocketTransport(config);
    default:
      throw new Error(`Unsupported transport type: ${(config as any).type}`);
  }
}