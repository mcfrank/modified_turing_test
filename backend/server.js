const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Serve Static Files (The React App)
// Make sure this points to where you copied the files in the Dockerfile
app.use(express.static(path.join(__dirname, 'public')));

// 2. Your API Routes
app.get('/api/hello', (req, res) => {
  res.json({ message: "Hello from Node Backend" });
});

// 3. Socket.io Logic
io.on('connection', (socket) => {
  console.log('a user connected');
});

// 4. Catch-All Handler (IMPORTANT for React Router)
// Any request that doesn't match an API route or static file 
// sends back index.html so React can handle the routing.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});