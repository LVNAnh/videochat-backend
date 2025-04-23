const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
  },
});

// Store active users and their socket IDs
const activeUsers = {};
// Store active rooms
const activeRooms = {};

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Register user
  socket.on("register", (userId) => {
    console.log(`User ${userId} registered with socket ${socket.id}`);
    activeUsers[userId] = socket.id;

    // Notify other users that this user is online
    socket.broadcast.emit("user-online", userId);

    // Send list of online users to the newly connected user
    socket.emit("active-users", Object.keys(activeUsers));
  });

  // Initiate a call
  socket.on("call-user", ({ to, from, signalData, callType }) => {
    console.log(`Call from ${from} to ${to}`);
    const toSocketId = activeUsers[to];

    if (toSocketId) {
      io.to(toSocketId).emit("call-incoming", {
        from,
        signalData,
        callType,
      });
    } else {
      socket.emit("call-failed", { to, reason: "User is offline" });
    }
  });

  // Answer call
  socket.on("call-accepted", ({ to, from, signalData }) => {
    console.log(`Call accepted from ${from} to ${to}`);
    const toSocketId = activeUsers[to];

    if (toSocketId) {
      io.to(toSocketId).emit("call-accepted", {
        from,
        signalData,
      });
    }
  });

  // Decline call
  socket.on("call-declined", ({ to, from, reason }) => {
    console.log(`Call declined from ${from} to ${to}: ${reason}`);
    const toSocketId = activeUsers[to];

    if (toSocketId) {
      io.to(toSocketId).emit("call-declined", {
        from,
        reason,
      });
    }
  });

  // End call
  socket.on("end-call", ({ to, from }) => {
    console.log(`Call ended from ${from} to ${to}`);
    const toSocketId = activeUsers[to];

    if (toSocketId) {
      io.to(toSocketId).emit("call-ended", { from });
    }
  });

  // Create or join a room (for group calls)
  socket.on("join-room", ({ roomId, userId }) => {
    console.log(`User ${userId} joining room ${roomId}`);

    if (!activeRooms[roomId]) {
      activeRooms[roomId] = {
        participants: [userId],
        createdBy: userId,
        createdAt: new Date(),
      };
    } else {
      if (!activeRooms[roomId].participants.includes(userId)) {
        activeRooms[roomId].participants.push(userId);
      }
    }

    socket.join(roomId);

    // Notify others in the room
    socket.to(roomId).emit("user-joined", { userId, roomId });

    // Send current participants to the new user
    socket.emit("room-participants", {
      roomId,
      participants: activeRooms[roomId].participants,
    });
  });

  // Send signal to specific user in room
  socket.on("send-signal", ({ to, from, roomId, signalData }) => {
    console.log(`Signal from ${from} to ${to} in room ${roomId}`);
    const toSocketId = activeUsers[to];

    if (toSocketId) {
      io.to(toSocketId).emit("user-signal", {
        from,
        signalData,
        roomId,
      });
    }
  });

  // Return signal to requester
  socket.on("return-signal", ({ to, from, roomId, signalData }) => {
    console.log(`Return signal from ${from} to ${to} in room ${roomId}`);
    const toSocketId = activeUsers[to];

    if (toSocketId) {
      io.to(toSocketId).emit("receiving-returned-signal", {
        from,
        signalData,
        roomId,
      });
    }
  });

  // Leave room
  socket.on("leave-room", ({ roomId, userId }) => {
    console.log(`User ${userId} leaving room ${roomId}`);

    if (activeRooms[roomId]) {
      activeRooms[roomId].participants = activeRooms[
        roomId
      ].participants.filter((id) => id !== userId);

      // If room is empty, delete it
      if (activeRooms[roomId].participants.length === 0) {
        delete activeRooms[roomId];
      } else {
        // Notify others that user has left
        socket.to(roomId).emit("user-left", { userId, roomId });
      }
    }

    socket.leave(roomId);
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    // Find and remove the disconnected user
    const userId = Object.keys(activeUsers).find(
      (key) => activeUsers[key] === socket.id
    );

    if (userId) {
      delete activeUsers[userId];

      // Notify other users that this user is offline
      socket.broadcast.emit("user-offline", userId);

      // Remove user from all rooms
      Object.keys(activeRooms).forEach((roomId) => {
        if (activeRooms[roomId].participants.includes(userId)) {
          activeRooms[roomId].participants = activeRooms[
            roomId
          ].participants.filter((id) => id !== userId);

          // If room is empty, delete it
          if (activeRooms[roomId].participants.length === 0) {
            delete activeRooms[roomId];
          } else {
            // Notify others that user has left
            socket.to(roomId).emit("user-left", { userId, roomId });
          }
        }
      });
    }
  });
});

// Endpoints
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/active-users", (req, res) => {
  res.status(200).json({ users: Object.keys(activeUsers) });
});

app.get("/active-rooms", (req, res) => {
  res.status(200).json({ rooms: activeRooms });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
