import app from "./app.js";
import http from "http";
import { Server, Socket } from "socket.io";

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all origins for now, can be restricted to frontend URL
    methods: ["GET", "POST"],
  },
});

interface User {
  id: string;
  room: string;
}

// In-memory store for users and rooms for MVP
const users: Record<string, User> = {};
const rooms: Record<string, string[]> = {};

io.on("connection", (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join-room", (roomName: string) => {
    socket.join(roomName);
    users[socket.id] = { id: socket.id, room: roomName };
    if (!rooms[roomName]) {
      rooms[roomName] = [];
    }
    rooms[roomName].push(socket.id);

    console.log(`User ${socket.id} joined room ${roomName}`);
    // Notify others in the room (except sender) that a new user joined
    socket.to(roomName).emit("user-joined", socket.id);
  });

  socket.on("offer", (data: { sdp: any; roomName: string }) => {
    // Broadcast offer to others in the room
    socket.to(data.roomName).emit("offer", { sdp: data.sdp, senderId: socket.id });
    console.log(`Offer from ${socket.id} in room ${data.roomName}`);
  });

  socket.on("answer", (data: { sdp: any; roomName: string }) => {
    // Broadcast answer to others in the room
    socket.to(data.roomName).emit("answer", { sdp: data.sdp, senderId: socket.id });
    console.log(`Answer from ${socket.id} in room ${data.roomName}`);
  });

  socket.on("ice-candidate", (data: { candidate: any; roomName: string }) => {
    // Broadcast ICE candidate to others in the room
    socket.to(data.roomName).emit("ice-candidate", { candidate: data.candidate, senderId: socket.id });
    console.log(`ICE candidate from ${socket.id} in room ${data.roomName}`);
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    const user = users[socket.id];
    if (user) {
      const roomName = user.room;
      if (rooms[roomName]) {
        rooms[roomName] = rooms[roomName].filter(id => id !== socket.id);
        if (rooms[roomName].length === 0) {
          delete rooms[roomName];
        }
      }
      socket.to(roomName).emit("user-left", socket.id); // Notify others in the room
      delete users[socket.id];
      console.log(`User ${socket.id} left room ${roomName}`);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server (including Socket.IO) is running on port ${PORT}`);
});
