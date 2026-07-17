import { timingSafeEqual } from 'crypto';
import { IncomingMessage, Server, ServerResponse, createServer } from 'http';
import qrcodeTerminal from 'qrcode-terminal';
import { URL } from 'url';
import { logger } from '../utils/logger';

export type WhatsAppConnectionState =
  | 'starting'
  | 'initializing'
  | 'qr_required'
  | 'authenticated'
  | 'ready'
  | 'disconnected'
  | 'reconnecting'
  | 'auth_failure'
  | 'error'
  | 'destroyed';

interface QrCodeStatus {
  available: boolean;
  value?: string;
  terminal?: string;
  svg?: string;
  dataUrl?: string;
  generatedAt?: string;
  ageSeconds?: number;
  staleAfterSeconds: number;
  stale?: boolean;
}

interface WhatsAppStatus {
  state: WhatsAppConnectionState;
  ready: boolean;
  authenticated: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  lastEventAt: string;
  lastReadyAt?: string;
  lastAuthenticatedAt?: string;
  lastDisconnectedAt?: string;
  lastDisconnectedReason?: string;
  lastError?: string;
  nextReconnectDelayMs?: number;
  qr: QrCodeStatus;
}

export interface WhatsAppStatusUpdate {
  state?: WhatsAppConnectionState;
  ready?: boolean;
  authenticated?: boolean;
  reconnecting?: boolean;
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
  lastReadyAt?: string;
  lastAuthenticatedAt?: string;
  lastDisconnectedAt?: string;
  lastDisconnectedReason?: string;
  lastError?: string;
  nextReconnectDelayMs?: number;
}

type ComponentStatusProvider = () => Record<string, unknown>;

export class StatusApiService {
  private readonly processStartedAt = new Date();
  private readonly qrStaleAfterSeconds = 60;
  private readonly clients = new Set<ServerResponse>();
  private server: Server | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private qrStaleTimer: NodeJS.Timeout | null = null;
  private eventId = 0;
  private host = '127.0.0.1';
  private port = 3002;
  private componentStatusProvider: ComponentStatusProvider | null = null;
  private whatsapp: WhatsAppStatus = {
    state: 'starting',
    ready: false,
    authenticated: false,
    reconnecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    lastEventAt: new Date().toISOString(),
    qr: {
      available: false,
      staleAfterSeconds: this.qrStaleAfterSeconds,
    },
  };

  setComponentStatusProvider(provider: ComponentStatusProvider): void {
    this.componentStatusProvider = provider;
  }

  updateWhatsApp(update: WhatsAppStatusUpdate): void {
    this.whatsapp = {
      ...this.whatsapp,
      ...update,
      lastEventAt: new Date().toISOString(),
    };
    this.broadcastStatus();
  }

  setWhatsAppQr(value: string): void {
    this.clearQrStaleTimer();
    const generatedAt = new Date().toISOString();
    const svg = this.createQrSvg(value);
    let terminal = '';
    qrcodeTerminal.generate(value, { small: true }, output => {
      terminal = output;
    });

    this.whatsapp = {
      ...this.whatsapp,
      state: 'qr_required',
      ready: false,
      authenticated: false,
      lastEventAt: generatedAt,
      qr: {
        available: true,
        value,
        terminal,
        svg,
        dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        generatedAt,
        staleAfterSeconds: this.qrStaleAfterSeconds,
      },
    };
    this.broadcastStatus();
    this.qrStaleTimer = setTimeout(() => {
      this.qrStaleTimer = null;
      this.broadcastStatus();
    }, this.qrStaleAfterSeconds * 1000);
    this.qrStaleTimer.unref();
  }

  clearWhatsAppQr(broadcast: boolean = true): void {
    this.clearQrStaleTimer();
    if (!this.whatsapp.qr.available) {
      return;
    }
    this.whatsapp = {
      ...this.whatsapp,
      lastEventAt: new Date().toISOString(),
      qr: {
        available: false,
        staleAfterSeconds: this.qrStaleAfterSeconds,
      },
    };
    if (broadcast) {
      this.broadcastStatus();
    }
  }

  async start(port: number = 3002, host: string = process.env.STATUS_API_HOST || '127.0.0.1'): Promise<void> {
    if (this.server) {
      return;
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid status API port: ${port}`);
    }

    this.port = port;
    this.host = host;
    this.server = createServer((request, response) => this.handleRequest(request, response));

    try {
      await new Promise<void>((resolve, reject) => {
        const server = this.server!;
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(this.port, this.host, () => {
          server.off('error', onError);
          resolve();
        });
      });
    } catch (error) {
      this.server = null;
      throw error;
    }

    this.heartbeatTimer = setInterval(() => this.broadcastHeartbeat(), 15_000);
    this.heartbeatTimer.unref();
    logger.info(`Status API listening on http://${this.host}:${this.port}`);
    if (!this.getAuthToken()) {
      logger.warn('STATUS_API_TOKEN is not configured; status and WhatsApp QR endpoints are unauthenticated');
    }
  }

  async stop(): Promise<void> {
    this.clearQrStaleTimer();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();

    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    logger.info('Status API stopped');
  }

  getSnapshot(): Record<string, unknown> {
    const qr = this.getQrSnapshot();
    let components: Record<string, unknown> = {};
    try {
      components = this.componentStatusProvider?.() || {};
    } catch (error) {
      logger.error('Failed to collect component status:', error);
      components = { collectionError: this.errorMessage(error) };
    }

    return {
      overall: this.getOverallState(),
      timestamp: new Date().toISOString(),
      service: {
        name: 'soapy-whatsapp-agent',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        pid: process.pid,
        startedAt: this.processStartedAt.toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        statusApi: {
          host: this.host,
          port: this.port,
          authenticated: Boolean(this.getAuthToken()),
          streamClients: this.clients.size,
        },
      },
      whatsapp: {
        ...this.whatsapp,
        qr,
      },
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        memory: process.memoryUsage(),
      },
      components,
    };
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const origin = process.env.STATUS_API_CORS_ORIGIN || '*';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method !== 'GET') {
      this.writeJson(response, 405, { error: 'method_not_allowed', message: 'Only GET is supported' });
      return;
    }

    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      this.writeJson(response, 200, {
        ok: true,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      });
      return;
    }

    if (!this.isAuthorized(request)) {
      response.setHeader('WWW-Authenticate', 'Bearer realm="status-api"');
      this.writeJson(response, 401, { error: 'unauthorized', message: 'A valid bearer token is required' });
      return;
    }

    if (url.pathname === '/' || url.pathname === '/status') {
      this.writeJson(response, 200, this.getSnapshot());
      return;
    }

    if (url.pathname === '/ready') {
      const ready = this.whatsapp.ready;
      this.writeJson(response, ready ? 200 : 503, {
        ready,
        state: this.whatsapp.state,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (url.pathname === '/status/qr') {
      this.writeJson(response, 200, this.getQrSnapshot());
      return;
    }

    if (url.pathname === '/status/qr.svg') {
      const qr = this.getQrSnapshot();
      if (!qr.available || !qr.svg) {
        this.writeJson(response, 404, { error: 'qr_not_available', message: 'WhatsApp is not currently requesting a QR code' });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
      response.end(qr.svg);
      return;
    }

    if (url.pathname === '/status/stream') {
      this.openEventStream(request, response);
      return;
    }

    this.writeJson(response, 404, {
      error: 'not_found',
      message: 'Endpoint not found',
      endpoints: ['/health', '/ready', '/status', '/status/qr', '/status/qr.svg', '/status/stream'],
    });
  }

  private openEventStream(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.write('retry: 3000\n\n');
    this.clients.add(response);
    this.writeSse(response, 'status', this.getSnapshot());

    request.on('close', () => {
      this.clients.delete(response);
    });
  }

  private broadcastStatus(): void {
    if (this.clients.size === 0) {
      return;
    }
    const snapshot = this.getSnapshot();
    for (const client of this.clients) {
      this.writeSse(client, 'status', snapshot);
    }
  }

  private broadcastHeartbeat(): void {
    for (const client of this.clients) {
      this.writeSse(client, 'heartbeat', { timestamp: new Date().toISOString() });
    }
  }

  private writeSse(response: ServerResponse, event: string, data: unknown): void {
    try {
      this.eventId++;
      response.write(`id: ${this.eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      this.clients.delete(response);
      logger.debug(`Closed failed status stream client: ${this.errorMessage(error)}`);
    }
  }

  private writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  }

  private getQrSnapshot(): QrCodeStatus {
    if (!this.whatsapp.qr.available || !this.whatsapp.qr.generatedAt) {
      return {
        available: false,
        staleAfterSeconds: this.qrStaleAfterSeconds,
      };
    }

    const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(this.whatsapp.qr.generatedAt)) / 1000));
    return {
      ...this.whatsapp.qr,
      ageSeconds,
      stale: ageSeconds >= this.qrStaleAfterSeconds,
    };
  }

  private getOverallState(): 'healthy' | 'auth_required' | 'starting' | 'degraded' | 'stopped' {
    if (this.whatsapp.ready) {
      return 'healthy';
    }
    if (this.whatsapp.qr.available) {
      return 'auth_required';
    }
    if (this.whatsapp.state === 'destroyed') {
      return 'stopped';
    }
    if (this.whatsapp.state === 'starting' || this.whatsapp.state === 'initializing' || this.whatsapp.state === 'authenticated') {
      return 'starting';
    }
    return 'degraded';
  }

  private getAuthToken(): string | null {
    const token = process.env.STATUS_API_TOKEN?.trim();
    return token || null;
  }

  private clearQrStaleTimer(): void {
    if (this.qrStaleTimer) {
      clearTimeout(this.qrStaleTimer);
      this.qrStaleTimer = null;
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const expected = this.getAuthToken();
    if (!expected) {
      return true;
    }

    const authorization = request.headers.authorization || '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
  }

  private createQrSvg(value: string): string {
    // qrcode-terminal already vendors this implementation; using it keeps the runtime dependency set unchanged.
    const QrCode = require('qrcode-terminal/vendor/QRCode');
    const errorCorrection = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
    const qr = new QrCode(-1, errorCorrection.L);
    qr.addData(value);
    qr.make();

    const margin = 4;
    const moduleCount = qr.getModuleCount();
    const size = moduleCount + margin * 2;
    const cells: string[] = [];
    for (let row = 0; row < moduleCount; row++) {
      for (let column = 0; column < moduleCount; column++) {
        if (qr.modules[row][column]) {
          cells.push(`M${column + margin} ${row + margin}h1v1h-1z`);
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${cells.join('')}" fill="#000"/></svg>`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export const statusApiService = new StatusApiService();
