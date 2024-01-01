import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PLAYERSTATUS } from "./Enums.js";
import { generateHash } from "./Hash.js";
import { Timer, getMillis } from "./Timer.js";
import { totalmem } from "os";
import { Chess } from "chess.js";
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
const openGames = new Map(); // GameString : {}
const runningGames = new Map();

// GameString : {chessInstance, WhiteTimer, BlackTimer, WhiteId, BlackId}

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
const gameJoinfailed = (socket, msg) => {
  socket.emit("gameJoinFailed", msg);
};
const gameJoined = (socket, gameInfo) => {
  socket.emit("gameJoined", gameInfo);
};
const moveMessage = (senderSocket, gameString, moveObj, color) => {
  const name = idToUsername[senderSocket.id];
  const moveData = {
    senderId: senderSocket.id,
    gameString,
    moveObj,
    senderName: name,
    color,
  };
  io.to(gameString).emit("moveMessage", moveData);
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
  idToUsername.set(socket.id, username);
  idToStatus.set(socket.id, PLAYERSTATUS.Idle);
  console.log(`${username} Registered`);
  userRegistered(socket, { username });
};

const createGame = (socket, gameData) => {
  console.log("Created Game Req");
  const { isPublic, showEval, totalTime, timeIncrement, targetOpponent } =
    gameData;
  const playerStatus = idToStatus.get(socket.id);
  if (playerStatus != PLAYERSTATUS.Idle) return;
  const username = idToUsername.get(socket.id);
  console.log(username);

  const gameString = generateHash(username);
  const gameInfo = {
    creator: username,
    isPublic: isPublic,
    showEval: showEval,
    totalTime: totalTime,
    timeIncrement: timeIncrement,
    targetOpponent: targetOpponent,
    gameString: gameString,
    creatorColor: Math.random() < 0.5 ? "w" : "b",
    creatorId: socket.id,
  };
  console.log(gameInfo);
  openGames.set(gameString, gameInfo);
  idToStatus.set(username, PLAYERSTATUS.Queued);

  // Create Room
  socket.join(gameString);

  // Send Back To user
  gameCreated(socket, gameInfo);
};

const joinGame = (socket, gameData) => {
  const { gameString } = gameData;
  const gameInfo = openGames.get(gameString);

  if (
    !gameInfo ||
    (gameInfo.targetOpponent && gameInfo.targetOpponent != joinerName)
  ) {
    gameJoinfailed(socket, { msg: "Game already Started or doesnt Exist." });
    return;
  }

  console.log(`String : ${gameString}`);
  const joinerName = idToUsername.get(socket.id);
  const joinedId = socket.id;
  console.log("Join request");
  console.log(gameInfo);

  // Assigning Colors
  let joinerColor = "w";
  if (gameInfo.creatorColor == "w") joinerColor = "b";

  /*
  const gameInfo = {
    creator: username,
    isPublic: isPublic,
    showEval: showEval,
    totalTime: totalTime,
    timeIncrement: timeIncrement,
    targetOpponent: targetOpponent,
    gameString: gameString,
    creatorColor: Math.random() < 0.5 ? "w" : "b",
    creatorId: socket.id,
  };
  */

  let whiteId = socket.id;
  let blackId = gameInfo.creatorId;
  if (joinerColor != whiteId) {
    // Swap WhiteId, And BlackId
    [whiteId, blackId] = [blackId, whiteId];
  }
  const totalTimeInMillis = getMillis(gameInfo.totalTime);
  openGames.delete(gameString);
  const whiteTimer = new Timer(totalTimeInMillis);
  const blackTimer = new Timer(totalTimeInMillis);
  runningGames.set(gameString, {
    chessInstance: new Chess(),
    whiteTimer,
    blackTimer,
    whiteId,
    blackId,
  });

  runningGames.get(gameString).whiteTimer.start();

  const joinedGameInfo = {
    ...gameInfo,
    myColor: joinerColor,
    opponentName: gameInfo.creator,
  };

  socket.join(gameString);
  gameJoined(socket, joinedGameInfo);
  console.log("Game Joined.");
};

const sendMove = (socket, moveData) => {
  console.log(`Send mvoe Message`);
  console.log(moveData);
  if (!moveData || !moveData.gameString) return;
  const { gameString, moveObj, color } = moveData;
  const gameData = runningGames.get(gameString);
  if (!gameData) return;
  const { chessInstance, whiteTimer, blackTimer, whiteId, blackId } = gameData;
  if (chessInstance.turn() != color) return;
  if (socket.id != whiteId && socket.id != blackId) return;
  if (!isValidMove(chessInstance, moveObj)) return;

  // if valid Move
  chessInstance.move(moveObj);

  moveMessage(socket, gameString, moveObj, color);
  console.log("Move Message Emitted.");
};

io.on("connection", async (socket) => {
  //console.log("a user connected");
  //console.log(socket.id);

  socket.on("registerUser", (userData) => registerUser(socket, userData));
  socket.on("createGame", (data) => createGame(socket, data));
  socket.on("joinGame", (gameData) => joinGame(socket, gameData));
  socket.on("sendMove", (moveData) => {
    sendMove(socket, moveData);
  });
  socket.on("disconnect", (socket) => {
    console.log("Disconnected.");
  });
});

server.listen(3000, () => {
  console.log("server running at http://localhost:3000");
});

const isValidMove = (chessInstance, moveObj) => {
  const gameCopy = new Chess(); // Create a new instance
  gameCopy.load(chessInstance.fen()); // Load the position from the original instance

  const move = gameCopy.move(moveObj);

  if (move === null) {
    console.log("Invalid Move");
    return false;
  }
  return true;
};
