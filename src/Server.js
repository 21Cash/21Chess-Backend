import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { PLAYERSTATUS } from "./Enums.js";
import { generateHash } from "./Hash.js";
import { Timer, getMillis } from "./Timer.js";
import { totalmem, userInfo } from "os";
import { Chess } from "chess.js";
import { copyFileSync, stat } from "fs";
import { sourceMapsEnabled } from "process";

let PORT = process.env.PORT || 3000;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());

const idToUsername = new Map();
const openGames = new Map(); // GameString : {}
const runningGames = new Map(); // GameString : {}
const idToInfo = new Map(); // id : => {curGameString, isPlaying, }

// GameString : {chessInstance, WhiteTimer, BlackTimer, WhiteId, BlackId}

// Server Methods

const unRegisterPlayer = (socketId) => {
  // i.e Disconnected
  const inGame =
    idToInfo.get(socketId) == null ? false : idToInfo.get(socketId).isPlaying;
  const userInfo = idToInfo.get(socketId);
  const gameString = userInfo.curGameString;

  // Game Hasnt begun
  if (openGames.has(gameString)) {
    openGames.delete(gameString);
    idToUsername.delete(socketId);
    idToInfo.delete(socketId);
    return;
  }

  // If Game Started i.e 2 Players Joined
  if (inGame) {
    const gameInfo = runningGames.get(gameString);
    let winColor = "w"; // its opposite of disconnect's color
    if (socketId == gameInfo.whiteId) winColor = "b";
    idToUsername.delete(socketId);
    idToInfo.delete(socketId);
    endGame(gameString, winColor);
  }
};

function clearRoom(roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (room) {
    for (const socketId of room) {
      io.sockets.sockets.get(socketId).disconnect(true);
    }
  }
}

const endGame = (gameString, winner) => {
  console.log(`Ending Game ${gameString}`);
  // Winner => w, b, d
  const gameInfo = runningGames.get(gameString);
  const blackName = gameInfo.blackName;
  const whiteName = gameInfo.whiteName;
  const { whiteId, blackId } = gameInfo;
  const winnerName = whiteName;
  if (winner == "b") winnerName: blackName;
  const resultData = {
    isDraw: winner == "d" ? true : false,
    winColor: winner == "d" ? null : winner,
    winnerName: winner == "d" ? null : winnerName,
  };
  io.to(gameString).emit("endGame", resultData);
  runningGames.delete(gameString);

  // Set Infos Of Players
  setPlayingStatus(whiteId, false);
  setPlayingStatus(blackId, false);

  // Clear Room
  clearRoom(gameString);
};

const setPlayingStatus = (socketId, status, gameString) => {
  if (!idToUsername.get(socketId)) return;
  const curInfo = idToInfo.get(socketId);
  let gameCode = "";
  if (status) gameCode = gameString;
  idToInfo.set(socketId, {
    ...curInfo,
    isPlaying: status,
    curGameString: gameCode,
  });
};

// Server Methods Ends

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

const startGame = (gameString) => {
  const gameInfo = runningGames.get(gameString);
  if (!gameInfo) return;
  const whiteName = idToUsername.get(gameInfo.whiteId);
  const blackName = idToUsername.get(gameInfo.blackId);
  const gameData = {
    whiteName: whiteName,
    blackName: blackName,
  };

  setPlayingStatus(gameInfo.whiteId, true, gameString);
  setPlayingStatus(gameInfo.blackId, true, gameString);
  io.to(gameString).emit("startGame", gameData);
};
// Emits End

const registerUser = (socket, userData) => {
  const { username } = userData;
  const alreadyDuplicate = idToUsername.has(username);
  if (alreadyDuplicate) {
    userRegisterFailed(socket, { msg: "Name Already Taken." });
    return;
  }
  idToUsername.set(socket.id, username);
  console.log(`${username} Registered`);
  userRegistered(socket, { username });
};

const createGame = (socket, gameData) => {
  console.log(`Created Game Req By ${idToUsername.get(socket.id)}`);
  const { isPublic, showEval, totalTime, timeIncrement, targetOpponent } =
    gameData;
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
    creatorColor: Math.random() < 0.5 ? "w" : "b",
    creatorId: socket.id,
  };
  openGames.set(gameString, gameInfo);

  // Update Player Status
  setPlayingStatus(socket.id, true, gameString);

  // Create Room
  socket.join(gameString);

  // Send Back To user
  gameCreated(socket, gameInfo);
};

const joinGame = (socket, gameData) => {
  if (idToUsername.get(socket.id) == null) {
    gameJoinfailed(socket, { msg: "Invalid username." });
    return;
  }
  const { gameString } = gameData;
  const gameInfo = openGames.get(gameString);
  const joinerName = idToUsername.get(socket.id);

  if (
    !gameInfo ||
    (gameInfo.targetOpponent && gameInfo.targetOpponent != joinerName)
  ) {
    gameJoinfailed(socket, { msg: "Game already Started or doesnt Exist." });
    return;
  }

  const joinedId = socket.id;
  console.log(`Join request By ${joinerName} to ${gameString}`);

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
  const whiteName = idToUsername.get(whiteId);
  const blackName = idToUsername.get(blackId);
  runningGames.set(gameString, {
    chessInstance: new Chess(),
    whiteTimer,
    blackTimer,
    whiteId,
    blackId,
    whiteName,
    blackName,
  });

  runningGames.get(gameString).whiteTimer.start();

  const joinedGameInfo = {
    ...gameInfo,
    myColor: joinerColor,
    opponentName: gameInfo.creator,
  };

  setPlayingStatus(socket.id, true, gameString);

  socket.join(gameString);
  gameJoined(socket, joinedGameInfo);
  startGame(gameString);
  console.log("Game Joined.");
};

const sendMove = (socket, moveData) => {
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

  if (chessInstance.isDraw()) {
    endGame(gameString, "d");
    return;
  } else if (chessInstance.isCheckmate()) {
    let winner = "w";
    if (chessInstance.turn() == "w") winner = "b";
    endGame(gameString, winner);
    return;
  }
};

io.on("connection", (socket) => {
  socket.on("registerUser", (userData) => registerUser(socket, userData));
  socket.on("createGame", (data) => createGame(socket, data));
  socket.on("joinGame", (gameData) => joinGame(socket, gameData));
  socket.on("sendMove", (moveData) => {
    sendMove(socket, moveData);
  });
  socket.on("disconnect", () => {
    const username = idToUsername.get(socket.id);
    if (!username) return;
    const userInfo = idToInfo.get(socket.id);
    if (!userInfo) {
      idToUsername.delete(username);
    }
    if (username) console.log(`${username} disconnected.`);
    console.log(`${idToUsername.size} Players Online Now.`);
    for (let x of idToUsername.keys()) {
      console.log(x);
    }
    if (!username || !userInfo) {
      return;
    }
    unRegisterPlayer(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`server running at http://localhost:${PORT}`);
});

app.get("/test", (req, res) => {
  // Health Check
  res.status(200).send("200 OK");
});

app.get("/serverInfo", (req, res) => {
  const serverInfo = { playersOnline: idToUsername.size + 1 };
  res.status(200).send(serverInfo);
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

// Debugging
