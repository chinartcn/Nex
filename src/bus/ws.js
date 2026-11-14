import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

// 最小 WebSocket 实现（零依赖）：仅覆盖文本/二进制帧、分片、ping/pong、close、客户端掩码
export class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = null;
    this.closed = false;
    socket.on('data', (c) => this._onData(c));
    socket.on('close', () => this._onClose());
    socket.on('error', () => this._onClose());
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let frame;
    while ((frame = this._parseFrame())) this._handleFrame(frame);
  }

  _parseFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset); offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      len = Number(buf.readBigUInt64BE(offset)); offset += 8;
    }
    let maskKey;
    if (masked) {
      if (buf.length < offset + 4) return null;
      maskKey = buf.subarray(offset, offset + 4); offset += 4;
    }
    if (buf.length < offset + len) return null;
    let payload = buf.subarray(offset, offset + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    this.buffer = buf.subarray(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame(frame) {
    const { fin, opcode, payload } = frame;
    if (opcode === 0x8) return this.close();
    if (opcode === 0x9) return this._sendRaw(0xa, payload); // ping → pong
    if (opcode === 0xa) return; // 忽略客户端 pong
    if (opcode === 0x0) {
      this.fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(this.fragments);
        const op = this.fragOpcode;
        this.fragments = [];
        this.fragOpcode = null;
        this._emitMessage(op, full);
      }
      return;
    }
    if (!fin) {
      this.fragOpcode = opcode;
      this.fragments.push(payload);
      return;
    }
    this._emitMessage(opcode, payload);
  }

  _emitMessage(opcode, payload) {
    if (opcode === 0x1) this.emit('message', payload.toString('utf8'), 'text');
    else if (opcode === 0x2) this.emit('message', payload, 'binary');
  }

  _sendRaw(opcode, data) {
    if (this.closed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const len = buf.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, buf]));
    } catch {
      this.close();
    }
  }

  sendText(str) {
    this._sendRaw(0x1, Buffer.from(str, 'utf8'));
  }

  ping() {
    this._sendRaw(0x9, Buffer.alloc(0));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this._sendRaw(0x8, Buffer.alloc(0));
    } catch {}
    try {
      this.socket.end();
    } catch {}
    this.emit('close');
  }
}

// 挂到已有 http.Server 的 upgrade 事件上，仅处理 /@NavExt-ws
export function attachWebSocketServer(server, onConnection) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/@NavExt-ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );
    onConnection(new WebSocketConnection(socket));
  });
}
