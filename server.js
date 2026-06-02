const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const http = require('http');
const WebSocket = require('ws');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_SECRET = process.env.PROXY_SECRET || '';

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function authCheck(req, res, next) {
  if (!PROXY_SECRET) return next(); // no secret set = open
  const token = req.headers['x-proxy-secret'] || req.query.secret;
  if (token !== PROXY_SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ProChain WS Proxy',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Angel One REST proxy ─────────────────────────────────────────────────────
// Usage: POST /angel/rest?path=/rest/auth/angelbroking/user/v1/loginByPassword
app.all('/angel/rest', authCheck, async (req, res) => {
  const targetPath = req.query.path || '/rest/auth/angelbroking/user/v1/loginByPassword';
  const targetURL = `https://apiconnect.angelone.in${targetPath}`;

  try {
    const headers = { ...req.headers };
    delete headers['host'];
    delete headers['content-length'];

    const response = await fetch(targetURL, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': headers['x-usertype'] || 'USER',
        'X-SourceID': headers['x-sourceid'] || 'WEB',
        'X-ClientLocalIP': headers['x-clientlocalip'] || '127.0.0.1',
        'X-ClientPublicIP': headers['x-clientpublicip'] || '127.0.0.1',
        'X-MACAddress': headers['x-macaddress'] || '00:00:00:00:00:00',
        'X-PrivateKey': headers['x-privatekey'] || '',
        'Authorization': headers['authorization'] || '',
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Dhan REST proxy ──────────────────────────────────────────────────────────
app.all('/dhan/rest', authCheck, async (req, res) => {
  const targetPath = req.query.path || '/';
  const targetURL = `https://api.dhan.co${targetPath}`;

  try {
    const headers = req.headers;
    const response = await fetch(targetURL, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'access-token': headers['access-token'] || '',
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── NSE Feed proxy (Option Chain) ───────────────────────────────────────────
app.get('/nse/optionchain', authCheck, async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/option-chain',
        'Connection': 'keep-alive',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/nse/quote', authCheck, async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const url = `https://www.nseindia.com/api/quote-derivative?symbol=${symbol}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Angel One WebSocket bridge ───────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws/angel' });

wss.on('connection', (clientWs, req) => {
  console.log('[WS] Client connected');

  // Connect to Angel One SmartAPI WebSocket
  const angelWs = new WebSocket('wss://smartapisocket.angelone.in/smart-stream', {
    headers: {
      'Origin': 'https://smartapi.angelone.in',
    }
  });

  angelWs.on('open', () => {
    console.log('[WS] Angel One connected');
    clientWs.send(JSON.stringify({ type: 'proxy_connected', broker: 'angelone' }));
  });

  // Relay Angel → Client
  angelWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  // Relay Client → Angel
  clientWs.on('message', (data) => {
    if (angelWs.readyState === WebSocket.OPEN) {
      angelWs.send(data);
    }
  });

  angelWs.on('error', (err) => {
    console.error('[WS] Angel error:', err.message);
    clientWs.send(JSON.stringify({ type: 'proxy_error', error: err.message }));
  });

  angelWs.on('close', () => {
    console.log('[WS] Angel disconnected');
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'proxy_disconnected' }));
      clientWs.close();
    }
  });

  clientWs.on('close', () => {
    console.log('[WS] Client disconnected');
    if (angelWs.readyState === WebSocket.OPEN) angelWs.close();
  });

  clientWs.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`ProChain Proxy running on port ${PORT}`);
});
