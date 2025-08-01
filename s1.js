const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();

// Enable CORS for all routes
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Keep track of connected clients
let connectedClients = 0;

wss.on('connection', (ws) => {
  connectedClients++;
  console.log(`Client connected. Total clients: ${connectedClients}`);

  ws.on('message', (data) => {
    try {
      // Parse the incoming data
      const message = JSON.parse(data.toString());
      console.log('Received:', message);

      // Broadcast to all other clients
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(message));
        }
      });
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    connectedClients--;
    console.log(`Client disconnected. Total clients: ${connectedClients}`);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Basic route for testing
app.get('/', (req, res) => {
  res.json({ 
    message: 'Collaborative Drawing Server', 
    connectedClients: connectedClients 
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('WebSocket server is ready for connections');
});