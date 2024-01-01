import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PLAYERSTATUS } from "./Enums.js";
import { generateHash } from "./Hash.js";
import { copyFileSync } from "fs";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// app.use(cors());

const idToUsername = new Map();
const idToStatus = new Map(); // Idle, InGame, Queued
const openGames = new Map();

// Emits
const userRegistered = (socket, userData) => {
  socket.emit("userRegistered", userData);
};
const userRegisterFailed = (socket, msg) => {
  socket.emit("userRegisterFailed", msg);
};
const gameCreated = (socket, gameInfo) => {
  socket.emit("gameCreated", gameInfo);
};

// Emits End

const registerUser = (socket, userData) => {
  console.log(userData);
  const { username } = userData;
  const alreadyDuplicate = idToUsername.has(username);
  if (alreadyDuplicate) {
    userRegisterFailed(socket, { msg: "Name Already Taken." });
    return;
  }
  idToUsername.set(username, socket.id);
  idToStatus.set(socket.id, PLAYERSTATUS.Idle);
  console.log(`${username} Registered`);
  userRegistered(socket, { username });
};

const createGame = (socket, gameData) => {
  console.log("Created Game Req");
  const { isPublic, showEval, totalTime, timeIncrement, targetOpponent } =
    gameData;
  const playerStatus = idToStatus.get(socket.id);
  console.log(`PStatus : ${idToStatus[socket.id]}`);
  if (playerStatus != PLAYERSTATUS.Idle) return;
  const username = idToUsername.get(socket.id);

  const gameString = generateHash(username);
  const gameInfo = {
    creator: username,
    isPublic: isPublic,
    showEval: showEval,
    totalTime: totalTime,
    timeIncrement: timeIncrement,
    targetOpponent: targetOpponent,
    gameString: gameString,
  };
  openGames.set(gameString, gameInfo);
  idToStatus[username] = PLAYERSTATUS.Queued;

  // Send Back To user
  gameCreated(socket, gameInfo);
};

io.on("connection", async (socket) => {
  //console.log("a user connected");
  //console.log(socket.id);

  socket.on("registerUser", (userData) => registerUser(socket, userData));
  socket.on("createGame", (data) => createGame(socket, data));
});

server.listen(3000, () => {
  console.log("server running at http://localhost:3000");
});
