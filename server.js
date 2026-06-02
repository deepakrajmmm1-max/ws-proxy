const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_SECRET = process.env.PROXY_SECRET || '';

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Auth middleware
function authCheck(req, res, next) {
  if (!PROXY_SECRET) return next();
  const token = req.headers['x-proxy-secret'] || req.query.secret;
  if (token !== PROXY_SECRET) return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ProChain Proxy',
    version: '3.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Angel One REST proxy
app.all('/angel/rest', authCheck, async (req, res) => {
  const targetPath = req.query.path || '/rest/auth/angelbroking/user/v1/loginByPassword';
  const targetURL = `https://apiconnect.angelone.in${targetPath}`;
  try {
    const h = req.headers;
    const response = await fetch(targetURL, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': h['x-usertype'] || 'USER',
        'X-SourceID': h['x-sourceid'] || 'WEB',
        'X-ClientLocalIP': h['x-clientlocalip'] || '127.0.0.1',
        'X-ClientPublicIP': h['x-clientpublicip'] || '127.0.0.1',
        'X-MACAddress': h['x-macaddress'] || '00:00:00:00:00:00',
        'X-PrivateKey': h['x-privatekey'] || '',
        'Authorization': h['authorization'] || '',
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dhan REST proxy
app.all('/dhan/rest', authCheck, async (req, res) => {
  const targetPath = req.query.path || '/';
  const targetURL = `https://api.dhan.co${targetPath}`;
  try {
    const response = await fetch(targetURL, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'access-token': req.headers['access-token'] || '',
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NSE Option Chain proxy
app.get('/nse/optionchain', authCheck, async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const url = `https://www.nseindia.com/api/option-chain-indices?symbol=${symbol}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/option-chain',
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NSE Quote proxy
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

// WebSocket bridge — Angel One
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws/angel' });

wss.on('connection', (clientWs) => {
  console.log('[WS] Client connected');
  const angelWs = new WebSocket('wss://smartapisocket.angelone.in/smart-stream', {
    headers: { 'Origin': 'https://smartapi.angelone.in' }
  });

  angelWs.on('open', () => {
    clientWs.send(JSON.stringify({ type: 'proxy_connected', broker: 'angelone' }));
  });
  angelWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });
  clientWs.on('message', (data) => {
    if (angelWs.readyState === WebSocket.OPEN) angelWs.send(data);
  });
  angelWs.on('error', (err) => {
    clientWs.send(JSON.stringify({ type: 'proxy_error', error: err.message }));
  });
  angelWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });
  clientWs.on('close', () => {
    if (angelWs.readyState === WebSocket.OPEN) angelWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`ProChain Proxy v3.0 running on port ${PORT}`);
});
