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
    origin: ["http://localhost:3000", "http://yourvibes.duckdns.org:3000"],
    methods: ["GET", "POST"],
  },
});

const activeUsers = {};
const activeRooms = {};

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("register", (userId) => {
    console.log(`User ${userId} registered with socket ${socket.id}`);
    activeUsers[userId] = socket.id;

    socket.broadcast.emit("user-online", userId);

    socket.emit("active-users", Object.keys(activeUsers));
  });

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

  socket.on("end-call", ({ to, from }) => {
    console.log(`Call ended from ${from} to ${to}`);
    const toSocketId = activeUsers[to];

    if (toSocketId) {
      io.to(toSocketId).emit("call-ended", { from });
    }
  });

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

    socket.to(roomId).emit("user-joined", { userId, roomId });

    socket.emit("room-participants", {
      roomId,
      participants: activeRooms[roomId].participants,
    });
  });

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

  socket.on("leave-room", ({ roomId, userId }) => {
    console.log(`User ${userId} leaving room ${roomId}`);

    if (activeRooms[roomId]) {
      activeRooms[roomId].participants = activeRooms[
        roomId
      ].participants.filter((id) => id !== userId);

      if (activeRooms[roomId].participants.length === 0) {
        delete activeRooms[roomId];
      } else {
        socket.to(roomId).emit("user-left", { userId, roomId });
      }
    }

    socket.leave(roomId);
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    const userId = Object.keys(activeUsers).find(
      (key) => activeUsers[key] === socket.id
    );

    if (userId) {
      delete activeUsers[userId];

      socket.broadcast.emit("user-offline", userId);

      Object.keys(activeRooms).forEach((roomId) => {
        if (activeRooms[roomId].participants.includes(userId)) {
          activeRooms[roomId].participants = activeRooms[
            roomId
          ].participants.filter((id) => id !== userId);

          if (activeRooms[roomId].participants.length === 0) {
            delete activeRooms[roomId];
          } else {
            socket.to(roomId).emit("user-left", { userId, roomId });
          }
        }
      });
    }
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/active-users", (req, res) => {
  res.status(200).json({ users: Object.keys(activeUsers) });
});

app.get("/active-rooms", (req, res) => {
  res.status(200).json({ rooms: activeRooms });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
